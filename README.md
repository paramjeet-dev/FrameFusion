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
  *and* trim *and* set quality in the same pass, or none of them (a plain format convert). This
  replaced an earlier "pick resize OR compress OR trim OR convert" model; the reference UI
  exposes all three simultaneously, which is also just a better way to build this — see
  `server/models/Job.js` and `server/services/ffmpegService.js`.
- **Upload → job → process** is three separate steps. A file is uploaded (chunked, see below)
  and probed for metadata first; job creation then references that file by `uploadId` and never
  re-sends the bytes; the actual FFmpeg work happens in a BullMQ **worker**, which currently
  runs in the same Node process as the API (`server/services/worker.js` is required by
  `server.js`) — pulling it into a separate process later is a config change, not a rewrite.
- **Status updates are pushed, not polled.** The worker emits progress/status changes onto an
  in-process event bus (`server/services/jobEvents.js`); `server.js` re-broadcasts those over
  Socket.IO to every connected client. This only works because the worker and the socket server
  share a process — if the worker ever moves to its own process, this event bus needs to become
  Redis pub/sub instead (Redis is already a dependency via BullMQ, so that's a small change).
- **Cancellation** kills the in-flight `ffmpeg` child process directly. The worker keeps a
  `Map<jobId, command>` of whatever's currently running; `POST /api/jobs/:id/cancel` looks the
  job up and calls `.kill('SIGKILL')` on its command if it's active, or flags it so the worker
  skips it entirely if it's still queued.
- **Codec selection is format-aware.** `webm` output uses `libvpx-vp9` + `libopus` with explicit
  speed flags (`-deadline good -cpu-used 4 -row-mt 1`); everything else uses `libx264` + `aac`.
  The old version always forced `libx264` regardless of container, which is invalid for webm and
  would have hit VP9's notoriously slow default settings if it had ever gotten that far — fixed
  while rebuilding this rather than left as a latent bug.
- **No auth** — open/anonymous usage, unchanged from v1.

## File Lifecycle
- The **original upload** is deleted immediately once its job finishes (success, failure, or cancellation).
- **Processed output** is kept so it can be downloaded, then either:
  - deleted immediately after a successful download if the job's `deleteOnDownload` is `true` (the default), or
  - deleted by the hourly cleanup job once older than `CLEANUP_MAX_AGE_HOURS` (default 24h), or the job's own `retentionHours` override if set (both tucked under "Advanced options" in the UI, since they're secondary to the main export controls).
  The Job record itself is kept for history but marked `expired: true`; `GET /api/jobs/:id/download` returns `410 Gone` for expired jobs.
- **Abandoned chunked uploads** (browser closed mid-upload) are swept after 6 hours regardless of the global retention setting.

## Backend Setup
```bash
cd server
npm install
cp .env.example .env   # adjust MONGO_URI / REDIS_URL if needed
npm run dev             # requires nodemon (npm install -g nodemon), or `npm start`
```

Requires **both MongoDB and Redis** running locally (or pointed at remote instances via
`MONGO_URI` / `REDIS_URL`).

```bash
# quick local Redis if you don't have one:
docker run -p 6379:6379 redis
```

**Note on `server/nodemon.json`:** nodemon watches the whole project directory by default,
including `server/uploads/` and `server/processed/` — which the app itself writes to constantly
(every chunk of a chunked upload, every processed output file). Without the ignore rules in
`nodemon.json`, nodemon restarts mid-upload/mid-job, which surfaces to the client as "Failed to
fetch" or "Unexpected end of JSON input" (the connection gets cut mid-response). If you ever see
either of those with no real error in the logs, check for `[nodemon] restarting due to changes`
in the terminal — it's easy to miss since it isn't printed as an error.

## API

### `GET /api/config`
Returns `{ maxFileSizeMB, supportedFormats, defaultRetentionHours }`. The frontend reads this
once on load so client-side validation and dropdowns stay in sync with the server.

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
- `outputFormat` — one of `mp4`, `mov`, `avi`, `flv`, `m4v`, `webm`
- `options` — any combination, all optional except quality (which always applies):
  - `resize`: `{ "width": 1280, "height": 720, "preserveAspectRatio": true }` or `null`/omitted to keep the source resolution
  - `quality`: `0-100`, default `100` — maps to a codec-appropriate CRF (see `qualityToCrf()` in `ffmpegService.js`)
  - `trim`: `{ "startTime": 5, "duration": 10 }` (seconds) or `null`/omitted to keep the full length
- `retentionHours` — optional; overrides `CLEANUP_MAX_AGE_HOURS` for this job's processed file
- `deleteOnDownload` — optional, default `true`

Response: `{ "jobId", "status" }`. Enqueues onto BullMQ and returns immediately. Rate limited to
20 jobs / 15 min per IP.

### `GET /api/jobs/:id`
Response: `{ "jobId", "status", "progress", "errorMessage", "filename", "transforms", "outputFormat", "createdAt", "expired", "retentionHours", "deleteOnDownload", "downloadUrl" }`

`transforms` is a short human-readable summary of what the job actually did (e.g. `"resize · quality 60 · trim"`, or `"convert"` if none of the optional transforms were used) — there's no single `operation` field anymore since a job can combine any mix.

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
- [ ] Move the worker to its own process/deployment once load justifies it (event bus becomes Redis pub/sub instead of a local EventEmitter)
- [ ] Per-job concurrency limits / priority in the BullMQ queue
- [ ] Reconnection handling: a reconciliation fetch on socket reconnect, in case updates were missed while disconnected
- [ ] Live preview of trim range against the actual video (currently just numeric h:m:s inputs)
