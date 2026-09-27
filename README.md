# FrameFusion

Video utility tool to resize, compress, trim, convert, and extract audio/thumbnails/sprite
sheets from videos in mp4, mov, avi, flv, m4v, and webm formats.

## Stack
- **Backend:** Node.js + Express + MongoDB (Mongoose)
- **Queue:** BullMQ + Redis — job processing runs through a queue rather than in-process
- **Realtime:** Socket.IO — job status is pushed to clients, not polled
- **Processing:** FFmpeg via `fluent-ffmpeg` (binary bundled through `@ffmpeg-installer/ffmpeg`, no system install needed)
- **Logging:** Pino — structured JSON logs, not `console.log`
- **Testing:** Jest + Supertest
- **Frontend:** React (Vite)

## Testing
```bash
cd server
npm test          # single run
npm run test:watch
```
Coverage is deliberately concentrated on business logic rather than I/O-heavy infrastructure
code: `validateJobInput` (every export/thumbnail/spritesheet validation branch),
`ffmpegService`'s pure quality-mapping functions (`qualityToCrf`, `qualityToAudioBitrateKbps`,
`qualityToGifFps`), `detectFileType` (the magic-byte sniffer, including "renamed file" spoofing
attempts), `serializeJob`'s transform-summary logic, and `jobCreationService` (mocked
Mongo/Redis/filesystem — validates the shared logic behind both single and batch job creation
without needing live infrastructure). `tests/app.test.js` exercises the actual Express routing
via Supertest against `app.js` (see below) with `jobCreationService` mocked, to confirm errors
map to the right HTTP status codes end-to-end.

Not yet covered: the cleanup service (heavy fs/Mongo mocking, lower priority than the validation
paths above) and the worker itself (would need a real or heavily-mocked ffmpeg process to test
meaningfully — a candidate for a future integration-test pass with a tiny fixture video).

## Architecture
- **`app.js` vs `server.js`:** the Express app (routes, middleware, error handling) is defined in
  `app.js` and exported as a factory function, separate from `server.js`'s bootstrap (Mongo
  connect, Socket.IO, cron, actually listening on a port). This split is what makes the app
  testable with Supertest at all — tests exercise `createApp()` directly with no live server, no
  live database.
- **A job is a single unified export, not one operation picked from a list.** Resize, quality,
  and trim are each independently optional and combine into one ffmpeg command — you can resize
  *and* trim *and* set quality in the same pass, or none of them (a plain format convert). See
  `server/models/Job.js` and `server/services/ffmpegService.js`.
- **API and worker are separate processes.** `server.js` runs the Express API and the Socket.IO
  layer; `worker.js` runs the BullMQ worker that actually does the FFmpeg work. Both connect to
  the same MongoDB and Redis. They used to share a process (worker required directly by
  `server.js`); splitting them meant two things that used to be direct in-memory calls had to
  become Redis messages instead:
  - **Job status updates:** the worker publishes to a `framefusion:job-updates` Redis channel
    (`server/services/jobEvents.js`); the API subscribes and re-broadcasts over Socket.IO. This
    used to be a plain Node `EventEmitter`, which only worked because both lived in one process.
  - **Cancellation:** the API publishes to a `framefusion:cancel-requests` channel
    (`server/services/cancelChannel.js`); the worker subscribes and kills the matching ffmpeg
    process from its own `Map<jobId, command>`. The API can no longer reach that Map directly,
    so `POST /api/jobs/:id/cancel` can't return a live active/queued check the way it used to —
    it now infers that from the job's own `status` field in Mongo instead, which is equivalent.
  - Both processes assume **shared local disk** for `uploads/`/`processed/` — fine on one
    machine, but would need shared storage (S3 or similar) if the worker ever runs on a
    different host than the API. Under Docker, this is satisfied by mounting the same named
    volumes into both the `backend` and `worker` containers (see "Running with Docker" below).
- **Codec selection is format-aware.** `webm` output uses `libvpx-vp9` + `libopus` with explicit
  speed flags (`-deadline good -cpu-used 4 -row-mt 1`); other video formats use `libx264` + `aac`;
  audio-only exports use `libmp3lame`/`aac`/`pcm_s16le`/`flac` depending on the target format,
  with `-vn` to drop the video stream entirely; `gif` output uses a two-filter
  palettegen/paletteuse graph (plain GIF encoding without a generated palette looks visibly
  banded).
- **Uploads are verified by content, not just extension.** `server/utils/detectFileType.js` reads
  the first bytes of the assembled upload and checks them against known container signatures
  (ISO-BMFF `ftyp` for mp4/mov, RIFF/AVI, FLV, EBML for webm) before it's ever probed or queued.
  Renaming a non-video file to `.mp4` gets rejected at upload time with a specific error, rather
  than failing confusingly later in ffmpeg or (worse) silently accepting an arbitrary file. This
  is a small, dependency-free, deliberately narrow sniffer — just enough to catch spoofing for
  the specific containers this app claims to support, not a general-purpose file-type library.
- **Batch processing shares the same validation/creation path as a single job.**
  `server/services/jobCreationService.js` holds the one place that validates an upload reference
  and export options and enqueues the job; both `POST /api/jobs` and `POST /api/jobs/batch` call
  it per-file, so the two code paths can't drift apart. In a batch, each file succeeds or fails
  independently — one bad file doesn't block the rest, and the response lists a result per
  upload. The frontend's batch mode intentionally doesn't expose Resolution or Duration controls,
  since those need per-file context (source resolution, source length) that doesn't generalize
  across an arbitrary set of files with different dimensions/lengths — Format, Quality, and Audio
  Only apply uniformly instead.
- **Thumbnails and sprite sheets are a different `kind` of job, not another output format.** A
  job's `kind` is `export` (default), `thumbnail`, or `spritesheet` — the latter two produce a
  still image rather than a processed video/audio file, and have their own much smaller options
  shape (`timestamp` for a thumbnail; `frameCount`/`columns` for a sprite sheet) rather than
  resize/quality/trim/audioOnly. A sprite sheet samples `frameCount` frames evenly across the
  whole video (`fps = frameCount / durationSeconds`, so they land evenly spaced regardless of the
  source's actual framerate) and tiles them into one grid image via ffmpeg's `tile` filter — the
  same kind of strip used for scrubbing previews on a seek bar.
- **Structured logging via Pino**, not `console.log`. Every log call is a JSON object with fields
  (`jobId`, `status`, `durationMs`, etc.), not a formatted string — the difference between "grep
  the logs" and "query the logs" once there's a real aggregator behind this. `app.js` logs every
  HTTP request (method/path/status/duration); the worker logs job lifecycle events.
- **No auth** — open/anonymous usage, unchanged from v1.

## File Lifecycle
- The **original upload** is deleted immediately once its job finishes (success, failure, or cancellation).
- **Processed output** is kept so it can be downloaded, then either:
  - deleted immediately after a successful download if the job's `deleteOnDownload` is `true` (the default), or
  - deleted by the hourly cleanup job once older than `CLEANUP_MAX_AGE_HOURS` (default 24h), or the job's own `retentionHours` override if set (both tucked under "Advanced options" in the UI, since they're secondary to the main export controls).
  The Job record itself is kept for history but marked `expired: true`; `GET /api/jobs/:id/download` returns `410 Gone` for expired jobs.
- **Abandoned chunked uploads** (browser closed mid-upload) are swept after 6 hours regardless of the global retention setting.

## Backend Setup
Two processes now, in two terminals:
```bash
cd server
npm install
cp .env.example .env   # adjust MONGO_URI / REDIS_URL if needed

# terminal 1 — API + WebSocket
npm run dev

# terminal 2 — video processing worker
npm run dev:worker
```
(`npm start` / `npm run worker` for production, without the nodemon file-watching.)

Requires **both MongoDB and Redis** running locally (or pointed at remote instances via
`MONGO_URI` / `REDIS_URL`) — both processes connect to both.

```bash
# quick local Redis if you don't have one:
docker run -p 6379:6379 redis
```

**Note on `server/nodemon.json`:** nodemon watches the whole project directory by default,
including `server/uploads/` and `server/processed/` — which the app itself writes to constantly
(every chunk of a chunked upload, every processed output file). Without the ignore rules in
`nodemon.json`, nodemon restarts mid-upload/mid-job, which surfaces to the client as "Failed to
fetch" or "Unexpected end of JSON input" (the connection gets cut mid-response). This applies to
`dev:worker` too, since it's the worker process writing those files — the same `nodemon.json` in
`server/` covers both scripts automatically.


## Frontend Setup
```bash
cd client
npm install
npm run dev   # runs on http://localhost:5173, proxies /api to :5000
```

The Socket.IO client connects directly to `http://localhost:5000` in dev (Vite's `/api` proxy
only covers HTTP, not the WebSocket upgrade) — see `client/src/socket.js`.

## Running with Docker

The whole stack — API, worker, frontend, and (optionally) Mongo/Redis — can run under Docker
instead of the manual two-terminal setup above. Two compose files are provided depending on
where your databases live.

**Images:** `server/Dockerfile` builds a single image shared by both the `backend` and `worker`
services (same codebase, different `command:`). It's pinned to `node:20-slim`, **not** an Alpine
base — `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` download prebuilt
glibc-linked binaries on `npm install`, and those won't execute against Alpine's musl libc.
`client/Dockerfile` is a multi-stage build: Vite builds the static bundle, then nginx serves it
and reverse-proxies `/api` and `/socket.io/` to the backend container (see `client/nginx.conf`)
so the existing same-origin Socket.IO client code (`client/src/socket.js`) works unmodified in
production — no separate WebSocket host needed the way dev mode requires.

**Shared disk:** `backend` and `worker` mount the same `uploads` and `processed` named volumes,
which is the containerized equivalent of the "shared local disk" assumption already noted above
in Architecture — both processes must see the same files.

### Case A — Mongo and Redis run in Docker too

```bash
docker compose up --build
```

This starts `mongo`, `redis`, `backend` (port 5000), `worker`, and `frontend` (port 3000, via
nginx). Service names double as hostnames on the Docker network, so `backend`/`worker` connect
to `mongodb://mongo:27017/framefusion` and `redis://redis:6379` rather than `localhost`. Data
persists in the `mongo-data`/`redis-data` named volumes across restarts.

### Case B — Mongo and Redis are external (Atlas, Upstash, a managed box, etc.)

```bash
cp .env.docker.example .env
# edit .env with your real MONGO_URI / REDIS_URL
docker compose -f docker-compose.external.yml up --build
```

This starts only `backend`, `worker`, and `frontend` — no database containers — and loads
connection details from `.env` via `env_file`. Everything else (shared volumes, the nginx proxy,
the image build) is identical to Case A.

### Notes
- Rebuild after dependency or code changes: `docker compose up --build` (add `-f
  docker-compose.external.yml` for Case B).
- `backend` exposes a Docker `HEALTHCHECK` against the existing `GET /api/health` route.
- Tests (`npm test` in `server/`) are not run inside these containers — run them locally or wire
  them into CI separately; the Docker images are for running the app, not the test suite.

## Design
Redesigned to match a reference UI the user provided: a light theme with a purple accent
(`#5b4fe8`), card-based layout, and — the bigger change — a single unified export panel instead
of picking one operation from a list. Layout:
- **Top row:** a video preview card (an actual thumbnail frame extracted client-side via
  `<video>` + `<canvas>`, not a static icon — the reference used a static mockup image here,
  this grabs the real first frame) with resolution/duration/codec/filename overlaid, next to the
  drag-and-drop zone.
- **Below:** Resolution + Quality (slider) + Duration (start/end as h:m:s) on the left; Format +
  Ratio + a progress bar + Save on the right, with retention/deleteOnDownload tucked under an
  "Advanced options" disclosure so the main panel stays uncluttered.
- **Ratio presets** (16:9, 9:16, 1:1, 4:3, 3:4, or Variable) recompute height from width live;
  "Variable" keeps the source aspect ratio locked while letting either field drive the other.
- **Audio only** toggle strips Resolution/Ratio out of the flow (they're disabled, not hidden —
  keeps the layout stable rather than reflowing) and switches the Format dropdown to audio
  formats; the Quality slider relabels to "Audio quality" and now drives bitrate instead of CRF.
- **Dark mode** toggle in the header, persisted to `localStorage`, defaulting to the OS-level
  `prefers-color-scheme` on first visit. Every color in `styles.css` is a CSS custom property, so
  the dark variant is a single `[data-theme='dark']` override block — no component needed a
  dark-specific class of its own.
- **Batch mode** toggle in the header swaps the single-file preview/dropzone for a multi-file
  drop zone with per-file upload status, and the Save button becomes "Save all (N)". Resolution
  and Duration are visibly disabled with a "Not available in batch mode" note rather than hidden,
  so it's clear they're a deliberate limitation, not a bug.
- **Quick actions** (thumbnail / sprite sheet generation) sit below the main export panel and
  operate on whichever file is currently loaded, alongside — not instead of — the main export.
  No separate upload needed; they reuse the same staged `uploadId`.

One deliberate deviation from the reference: it mocks up OS-style window chrome (traffic-light
buttons, minimize/maximize). This is a web app, not a desktop shell, so that's skipped rather
than faked — non-functional buttons that look clickable are worth avoiding on principle.

Typography is Inter for UI text with IBM Plex Mono reserved for anything measured (timecodes,
resolution, percentages, filenames) — a small distinctive touch carried over from the previous
dark-theme design rather than a pure reference copy.

## Next Steps
- [ ] Per-job concurrency limits / priority in the BullMQ queue
- [ ] Reconnection handling: a reconciliation fetch on socket reconnect, in case updates were missed while disconnected
- [ ] Live preview of trim range against the actual video (currently just numeric h:m:s inputs)
- [ ] Audio waveform in the preview card when "Audio only" is on (currently still shows the video frame thumbnail)
- [ ] Shared storage (S3 or similar) for `uploads/`/`processed/` if the worker and API ever run on different machines — currently assumes shared local disk
- [ ] Test coverage for the cleanup service and a real/fixture-video integration test for the worker (see "Testing" above)
- [ ] Batch mode support for per-file resize/trim (currently intentionally shared-settings-only — see the Batch Processing note in Architecture)
- [ ] Sprite sheet click-to-seek in the UI — right now the generated image downloads as a plain file rather than being used as an actual scrubbing preview
- [ ] Basic auth + rate-limit-by-user (rather than by IP) if this ever leaves single-user/localhost use
- [ ] Wire the Docker images into CI so `npm test` runs against the same environment they're built from
