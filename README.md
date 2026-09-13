# FrameFusion

Video utility tool to resize, compress, trim, and convert videos in mp4, mov, avi, flv, m4v, and webm formats.

## Stack
- **Backend:** Node.js + Express + MongoDB (Mongoose)
- **Queue:** BullMQ + Redis — job processing runs through a queue rather than in-process
- **Realtime:** Socket.IO — job status is pushed to clients, not polled
- **Processing:** FFmpeg via `fluent-ffmpeg` (binary bundled through `@ffmpeg-installer/ffmpeg`, no system install needed)
- **Frontend:** React (Vite)

## Architecture
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
    different host than the API.
- **Codec selection is format-aware.** `webm` output uses `libvpx-vp9` + `libopus` with explicit
  speed flags (`-deadline good -cpu-used 4 -row-mt 1`); other video formats use `libx264` + `aac`;
  audio-only exports use `libmp3lame`/`aac`/`pcm_s16le`/`flac` depending on the target format,
  with `-vn` to drop the video stream entirely.
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

## API

### `GET /api/config`
Returns `{ maxFileSizeMB, videoFormats, audioFormats, defaultRetentionHours }`. The frontend
reads this once on load so client-side validation and dropdowns stay in sync with the server.
`videoFormats` is also what uploads are validated against — the source file is always a video,
even for an audio-only export.

### Uploads
Two ways to get a file onto the server; both end with the same response shape:
`{ "uploadId", "originalFilename", "durationSeconds", "sizeBytes", "width", "height", "codec" }`.

- **`POST /api/uploads`** — single multipart request (`file` field).
- **Chunked** (what the frontend actually uses):
  1. `POST /api/uploads/init` — JSON `{ filename, totalChunks }` returns `{ uploadId }`
  2. `POST /api/uploads/:uploadId/chunk/:index` — raw binary body, one request per chunk (2MB
     chunks from the client), returns `204` per chunk
  3. `POST /api/uploads/:uploadId/complete` — assembles the chunks in order, probes the result,
     returns the same metadata shape as above

  Not resumable across a page reload — but real upload progress, and a single flaky request
  doesn't fail the whole transfer.

All upload endpoints are rate limited together: 300 requests / 15 min per IP.

### `POST /api/jobs`
JSON body: `{ "uploadId", "originalFilename", "outputFormat", "options", "retentionHours", "deleteOnDownload" }`
- `uploadId` — from a prior upload call
- `outputFormat` — one of `mp4`, `mov`, `avi`, `flv`, `m4v`, `webm` (video), or `mp3`, `aac`, `wav`, `flac` (audio-only, requires `options.audioOnly: true`)
- `options` — any combination, all optional except quality (which always applies):
  - `resize`: `{ "width": 1280, "height": 720, "preserveAspectRatio": true }` or `null`/omitted to keep the source resolution — rejected if `audioOnly` is set (no video stream to resize)
  - `quality`: `0-100`, default `100` — maps to a codec-appropriate CRF for video (see `qualityToCrf()`), or a bitrate from 64-320kbps for audio-only (see `qualityToAudioBitrateKbps()`), both in `ffmpegService.js`
  - `trim`: `{ "startTime": 5, "duration": 10 }` (seconds) or `null`/omitted to keep the full length — works the same whether or not `audioOnly` is set
  - `audioOnly`: boolean, default `false` — strips the video stream entirely (`-vn`); `outputFormat` must then be an audio format
- `retentionHours` — optional; overrides `CLEANUP_MAX_AGE_HOURS` for this job's processed file
- `deleteOnDownload` — optional, default `true`

Response: `{ "jobId", "status" }`. Enqueues onto BullMQ and returns immediately. Rate limited to
20 jobs / 15 min per IP.

### `GET /api/jobs/:id`
Response: `{ "jobId", "status", "progress", "errorMessage", "filename", "transforms", "outputFormat", "createdAt", "expired", "retentionHours", "deleteOnDownload", "downloadUrl" }`

`transforms` is a short human-readable summary of what the job actually did (e.g. `"resize · quality 60 · trim"`, `"audio only · trim"`, or `"convert"` if none of the optional transforms were used) — there's no single `operation` field anymore since a job can combine any mix.

`status` is one of `pending`, `processing`, `done`, `failed`, `cancelled`.

### `GET /api/jobs?limit=20&cursor=<jobId>&search=<text>&format=<ext>`
Cursor-paginated job history, newest first. `search` matches filenames case-insensitively;
`format` filters by output format exactly (replaces the old `operation` filter, which no longer
makes sense as a discrete concept).

### `GET /api/jobs/:id/download`
Streams the processed file. `410` if expired. Deletes the file immediately after a successful
transfer if `deleteOnDownload` is `true`.

### `POST /api/jobs/:id/cancel`
Cancels a `pending` or `processing` job. Response: `{ "jobId", "cancelRequested": true, "state": "active" | "queued" }`.

### `DELETE /api/jobs/:id`
Removes a job from the log and deletes any of its files still on disk.

### WebSocket: `job:update`
Emitted to all connected clients on every status/progress change — the frontend doesn't poll at all.

## Frontend Setup
```bash
cd client
npm install
npm run dev   # runs on http://localhost:5173, proxies /api to :5000
```

The Socket.IO client connects directly to `http://localhost:5000` in dev (Vite's `/api` proxy
only covers HTTP, not the WebSocket upgrade) — see `client/src/socket.js`.

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

One deliberate deviation from the reference: it mocks up OS-style window chrome (traffic-light
buttons, minimize/maximize). This is a web app, not a desktop shell, so that's skipped rather
than faked — non-functional buttons that look clickable are worth avoiding on principle.

Typography is Inter for UI text with IBM Plex Mono reserved for anything measured (timecodes,
resolution, percentages, filenames) — a small distinctive touch carried over from the previous
dark-theme design rather than a pure reference copy.

## Known Bug Fixed (earlier version)
The original FFmpeg wrapper attached `progress`/`end`/`error` listeners but never called
`command.run()` — `fluent-ffmpeg`'s `.output()` doesn't start execution on its own. This made
every job hang at `processing` / 0% forever. Fixed by adding `.run()` in `runCommand()`.

## Next Steps
- [ ] True resumable uploads (resume after a page reload, not just mid-session retry)
- [ ] Per-job concurrency limits / priority in the BullMQ queue
- [ ] Reconnection handling: a reconciliation fetch on socket reconnect, in case updates were missed while disconnected
- [ ] Live preview of trim range against the actual video (currently just numeric h:m:s inputs)
- [ ] Audio waveform in the preview card when "Audio only" is on (currently still shows the video frame thumbnail)
- [ ] Shared storage (S3 or similar) for `uploads/`/`processed/` if the worker and API ever run on different machines — currently assumes shared local disk
