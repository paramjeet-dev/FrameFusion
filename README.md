# FrameFusion

Video utility tool to resize, compress, trim, and convert videos in mp4, mov, avi, flv, m4v, and webm formats.

## Stack
- **Backend:** Node.js + Express + MongoDB (Mongoose)
- **Processing:** FFmpeg via `fluent-ffmpeg` (binary bundled through `@ffmpeg-installer/ffmpeg`, no system install needed)
- **Frontend:** React (to be added next)

## v1 Architecture Decisions
- Jobs run **asynchronously in-process** (no Redis/Bull yet) — request returns a `jobId` immediately, frontend polls for status.
- Files are stored **on local disk** (`server/uploads` for originals, `server/processed` for output).
- **No auth** in v1 — open/anonymous usage.

## File Lifecycle
- The **original upload** is deleted immediately once its job finishes (success or failure) — no need to wait for cleanup.
- **Processed output** is kept so it can be downloaded, then deleted by an hourly cleanup job once it's older than `CLEANUP_MAX_AGE_HOURS` (default 24h). The Job record itself is kept for history but marked `expired: true`, and `GET /api/jobs/:id/download` returns `410 Gone` for expired jobs.

## Backend Setup
```bash
cd server
npm install
cp .env.example .env   # adjust MONGO_URI etc. if needed
npm run dev             # requires nodemon (npm install -g nodemon), or `npm start`
```

Make sure MongoDB is running locally (or point `MONGO_URI` at Atlas/remote instance).

## API

### `POST /api/uploads`
Multipart form-data: `file`. Saves the file to disk and immediately probes it, in one round trip.
Response: `{ "uploadId", "originalFilename", "durationSeconds", "sizeBytes", "width", "height", "codec" }`.

The frontend calls this the moment a file is selected — `uploadId` is then passed to `POST /api/jobs`
instead of re-sending the file, so the video is only transferred over the network once.

### `POST /api/jobs`
JSON body: `{ "uploadId", "originalFilename", "operation", "outputFormat", "options" }`
- `uploadId` — from a prior `POST /api/uploads` call
- `operation` — one of `resize`, `compress`, `trim`, `convert`
- `outputFormat` — one of `mp4`, `mov`, `avi`, `flv`, `m4v`, `webm`
- `options` — shape depends on operation:
  - `resize`: `{ "width": 1280, "height": 720, "preserveAspectRatio": true }` (at least one of width/height required)
  - `compress`: `{ "crf": 28, "preset": "medium" }`
  - `trim`: `{ "startTime": 5, "duration": 10 }` (seconds)
  - `convert`: `{}` (outputFormat alone drives it)

Response: `{ "jobId", "status" }`

`resize` options also accept `preserveAspectRatio` (default `true`). With one dimension set,
the other is computed automatically; with both set and `preserveAspectRatio: true`, the video
is scaled to fit within the box without distortion. Set `false` for an exact (possibly
stretched) width × height.

### `GET /api/jobs/:id`
Response: `{ "jobId", "status", "progress", "errorMessage", "filename", "operation", "outputFormat", "createdAt", "expired", "downloadUrl" }`

`status` is one of `pending`, `processing`, `done`, `failed`.

### `GET /api/jobs?limit=50`
Returns recent job history (same shape as above, newest first) — used to repopulate the UI on page load.

### `GET /api/jobs/:id/download`
Streams back the processed file once `status` is `done`. Returns `410` if the file has expired and been cleaned up.

## Frontend Setup
```bash
cd client
npm install
npm run dev   # runs on http://localhost:5173, proxies /api to :5000
```

Open http://localhost:5173 — pick an operation on the left rail (resize, compress, trim,
convert), drop a video, set the operation's options and output format, and hit Run. The
job log at the bottom polls status every 1.5s and shows a download link once a job is done.

## Design Notes (client)
The UI treats the tool like a deck/control panel rather than a generic form: a left rail
for picking the operation, a VU-meter style segmented progress bar per job, and monospace
type (IBM Plex Mono) for anything measured — timecodes, percentages, filenames — paired
with IBM Plex Sans for labels. One amber accent marks the active/action state; teal is
reserved only for "done".

## Next Steps
- [ ] Client-side validation of file size before upload (currently relies on server 500MB cap)
- [ ] Consider Bull + Redis if concurrent load grows
- [ ] Pagination on `GET /api/jobs` beyond the `limit` param (cursor-based, for real history)
- [ ] Delete a job's processed file immediately once downloaded, instead of waiting for cleanup
