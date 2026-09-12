# FrameFusion

Video utility tool to resize, compress, trim, and convert videos in mp4, mov, avi, flv, m4v, and webm formats.

## Stack
- **Backend:** Node.js + Express + MongoDB (Mongoose)
- **Queue:** BullMQ + Redis — job processing runs through a queue rather than in-process
- **Realtime:** Socket.IO — job status is pushed to clients, not polled
- **Processing:** FFmpeg via `fluent-ffmpeg` (binary bundled through `@ffmpeg-installer/ffmpeg`, no system install needed)
- **Frontend:** React (Vite)

## Architecture
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
- **No auth** — open/anonymous usage, unchanged from v1.

## File Lifecycle
- The **original upload** is deleted immediately once its job finishes (success, failure, or cancellation).
- **Processed output** is kept so it can be downloaded, then either:
  - deleted immediately after a successful download if the job's `deleteOnDownload` is `true` (the default), or
  - deleted by the hourly cleanup job once older than `CLEANUP_MAX_AGE_HOURS` (default 24h), or the job's own `retentionHours` override if set.
  The Job record itself is kept for history but marked `expired: true`; `GET /api/jobs/:id/download` returns `410 Gone` for expired jobs.
- **Abandoned chunked uploads** (browser closed mid-upload) are swept after 6 hours regardless of the global retention setting — there's no reason to hold a dead upload session as long as a real job.

## Backend Setup
```bash
cd server
npm install
cp .env.example .env   # adjust MONGO_URI / REDIS_URL if needed
npm run dev             # requires nodemon (npm install -g nodemon), or `npm start`
```

Requires **both MongoDB and Redis** running locally (or pointed at remote instances via
`MONGO_URI` / `REDIS_URL`). Redis is new as of this version — Mongo alone is no longer enough,
since BullMQ needs it for the job queue.

```bash
# quick local Redis if you don't have one:
docker run -p 6379:6379 redis
```

## API

### `GET /api/config`
Returns `{ maxFileSizeMB, supportedFormats, operations, defaultRetentionHours }`. The frontend
reads this once on load so client-side validation and dropdowns stay in sync with whatever the
server actually enforces, rather than a hardcoded copy.

### Uploads
Two ways to get a file onto the server; both end with the same response shape:
`{ "uploadId", "originalFilename", "durationSeconds", "sizeBytes", "width", "height", "codec" }`.

- **`POST /api/uploads`** — single multipart request (`file` field). Simple, fine for small
  files or direct API use.
- **Chunked** (what the frontend actually uses):
  1. `POST /api/uploads/init` — JSON `{ filename, totalChunks }` returns `{ uploadId }`
  2. `POST /api/uploads/:uploadId/chunk/:index` — raw binary body, one request per chunk (2MB
     chunks from the client), returns `204` per chunk
  3. `POST /api/uploads/:uploadId/complete` — assembles the chunks in order, probes the result,
     cleans up the chunk directory, returns the same metadata shape as above

  This isn't resumable across a page reload (that needs tracking which chunks already landed,
  which is a further step up) — but it gives real upload progress and means a single flaky
  request doesn't fail the whole transfer.

All upload endpoints are rate limited together: 300 requests / 15 min per IP (generous because
a single chunked upload makes many requests).

### `POST /api/jobs`
JSON body: `{ "uploadId", "originalFilename", "operation", "outputFormat", "options", "retentionHours", "deleteOnDownload" }`
- `uploadId` — from a prior upload call
- `operation` — one of `resize`, `compress`, `trim`, `convert`
- `outputFormat` — one of `mp4`, `mov`, `avi`, `flv`, `m4v`, `webm`
- `options` — shape depends on operation:
  - `resize`: `{ "width": 1280, "height": 720, "preserveAspectRatio": true }` (at least one of width/height required)
  - `compress`: `{ "crf": 28, "preset": "medium" }`
  - `trim`: `{ "startTime": 5, "duration": 10 }` (seconds)
  - `convert`: `{}` (outputFormat alone drives it)
- `retentionHours` — optional; overrides `CLEANUP_MAX_AGE_HOURS` for this job's processed file
- `deleteOnDownload` — optional, default `true`

Response: `{ "jobId", "status" }`. This enqueues the job onto BullMQ and returns immediately —
it does not wait for processing. Rate limited to 20 jobs / 15 min per IP.

### `GET /api/jobs/:id`
Response: `{ "jobId", "status", "progress", "errorMessage", "filename", "operation", "outputFormat", "createdAt", "expired", "retentionHours", "deleteOnDownload", "downloadUrl" }`

`status` is one of `pending`, `processing`, `done`, `failed`, `cancelled`.

### `GET /api/jobs?limit=20&cursor=<jobId>&search=<text>&operation=<op>`
Cursor-paginated job history, newest first. `nextCursor` is the `jobId` to pass as `cursor` for
the next page (`null` when there are no more). `search` matches filenames case-insensitively;
`operation` filters exactly.

### `GET /api/jobs/:id/download`
Streams the processed file. `410` if expired. Deletes the file immediately after a successful
transfer if `deleteOnDownload` is `true`.

### `POST /api/jobs/:id/cancel`
Cancels a `pending` or `processing` job. Kills the ffmpeg process if it's actively running.
Response: `{ "jobId", "cancelRequested": true, "state": "active" | "queued" }`.

### `DELETE /api/jobs/:id`
Removes a job from the log and deletes any of its files still on disk.

### WebSocket: `job:update`
Emitted to all connected clients whenever a job's status or progress changes. Payload is either
a lightweight progress tick (`{ jobId, progress, status: "processing" }`) or the full job object
(same shape as `GET /api/jobs/:id`) on every status transition. The frontend doesn't poll at all
for job status anymore — this is the only source of live updates after the initial history load.

## Frontend Setup
```bash
cd client
npm install
npm run dev   # runs on http://localhost:5173, proxies /api to :5000
```

The Socket.IO client connects directly to `http://localhost:5000` in dev (Vite's `/api` proxy
only covers HTTP, not the WebSocket upgrade) — see `client/src/socket.js`.

Open http://localhost:5173 — pick an operation on the left rail, drop a video (uploads in 2MB
chunks with a progress bar), set the operation's options and output format, and hit Run. The job
log at the bottom updates live via WebSocket, supports search/filter/pagination, and lets you
cancel an in-flight job or delete any entry.

## Design Notes (client)
The UI treats the tool like a deck/control panel rather than a generic form: a left rail for
picking the operation, a VU-meter style segmented progress bar per job, and monospace type (IBM
Plex Mono) for anything measured — timecodes, percentages, filenames — paired with IBM Plex Sans
for labels. One amber accent marks the active/action state; teal is reserved only for "done".

## Known Bug Fixed (earlier version)
The original FFmpeg wrapper attached `progress`/`end`/`error` listeners but never called
`command.run()` — `fluent-ffmpeg`'s `.output()` doesn't start execution on its own. This made
every job hang at `processing` / 0% forever. Fixed by adding `.run()` in `runCommand()`.

## Next Steps
- [ ] True resumable uploads (resume after a page reload, not just mid-session retry)
- [ ] Move the worker to its own process/deployment once load justifies it (event bus becomes Redis pub/sub instead of a local EventEmitter)
- [ ] Per-job concurrency limits / priority in the BullMQ queue
- [ ] Reconnection handling: if the socket drops mid-job and reconnects, the client currently just waits for the next push — a reconciliation fetch on reconnect would close that gap
