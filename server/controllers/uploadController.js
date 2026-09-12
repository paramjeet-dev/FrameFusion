const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getMetadata } = require('../services/ffmpegService');
const { SUPPORTED_FORMATS } = require('../models/Job');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const CHUNKS_DIR = path.join(UPLOAD_DIR, 'chunks');

// ---------------------------------------------------------------------------
// Single-shot upload (small files) — kept for simple/API-direct use.
// The frontend now always uses the chunked flow below, which also works for
// small files, but this stays available since it's a simpler integration
// point for anything hitting the API directly.
// ---------------------------------------------------------------------------

async function stageUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const metadata = await getMetadata(req.file.path);
    return res.status(201).json({
      uploadId: req.file.filename,
      originalFilename: req.file.originalname,
      ...metadata,
    });
  } catch (err) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: `Could not read video metadata: ${err.message}` });
  }
}

// ---------------------------------------------------------------------------
// Chunked upload — three requests instead of one multipart POST, so large
// files don't ride on a single fragile request and the client can show real
// upload progress. Not resumable across a page reload (that needs tracking
// which chunks already landed and is a further step up in complexity) —
// but it does let a dropped connection retry mid-upload within the same
// session, and avoids the whole file failing as one atomic transfer.
// ---------------------------------------------------------------------------

// POST /api/uploads/init  { filename, totalChunks }
async function initUpload(req, res) {
  const { filename, totalChunks } = req.body || {};
  if (!filename || !Number.isInteger(totalChunks) || totalChunks <= 0) {
    return res.status(400).json({ error: 'filename and a positive integer totalChunks are required' });
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return res.status(400).json({
      error: `Unsupported format ".${ext}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
    });
  }

  const uploadId = crypto.randomUUID();
  const sessionDir = path.join(CHUNKS_DIR, uploadId);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, 'meta.json'),
    JSON.stringify({ filename, totalChunks, ext })
  );

  return res.status(201).json({ uploadId });
}

// POST /api/uploads/:uploadId/chunk/:index  (raw binary body)
async function uploadChunk(req, res) {
  const { uploadId, index } = req.params;
  const sessionDir = path.join(CHUNKS_DIR, uploadId);

  try {
    await fs.access(sessionDir);
  } catch {
    return res.status(404).json({
      error: 'Upload session not found (it may have expired) — please restart the upload',
    });
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Empty or invalid chunk body' });
  }

  const chunkPath = path.join(sessionDir, `${String(index).padStart(6, '0')}.part`);
  await fs.writeFile(chunkPath, req.body);
  return res.status(204).send();
}

// POST /api/uploads/:uploadId/complete
// Concatenates chunks in order into the final file, probes it, and cleans
// up the chunk directory.
async function completeUpload(req, res) {
  const { uploadId } = req.params;
  const sessionDir = path.join(CHUNKS_DIR, uploadId);

  let meta;
  try {
    meta = JSON.parse(await fs.readFile(path.join(sessionDir, 'meta.json'), 'utf8'));
  } catch {
    return res.status(404).json({ error: 'Upload session not found' });
  }

  const finalFilename = `${uploadId}.${meta.ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalFilename);

  try {
    await assembleChunks(sessionDir, meta.totalChunks, finalPath);
  } catch (err) {
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    return res.status(400).json({ error: `Failed to assemble upload: ${err.message}` });
  }

  await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});

  try {
    const metadata = await getMetadata(finalPath);
    return res.status(201).json({
      uploadId: finalFilename,
      originalFilename: meta.filename,
      ...metadata,
    });
  } catch (err) {
    await fs.unlink(finalPath).catch(() => {});
    return res.status(400).json({ error: `Could not read video metadata: ${err.message}` });
  }
}

function assembleChunks(sessionDir, totalChunks, finalPath) {
  return new Promise((resolve, reject) => {
    const writeStream = fsSync.createWriteStream(finalPath);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    (async () => {
      try {
        for (let i = 0; i < totalChunks; i++) {
          const chunkPath = path.join(sessionDir, `${String(i).padStart(6, '0')}.part`);
          const data = await fs.readFile(chunkPath); // throws if a chunk is missing
          await new Promise((res, rej) => writeStream.write(data, (err) => (err ? rej(err) : res())));
        }
        writeStream.end();
      } catch (err) {
        writeStream.destroy();
        reject(err);
      }
    })();
  });
}

module.exports = { stageUpload, initUpload, uploadChunk, completeUpload };
