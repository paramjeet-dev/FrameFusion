const path = require('path');
const fs = require('fs/promises');
const Job = require('../models/Job');
const { validateJobInput } = require('../utils/validateJobInput');
const { serializeJob } = require('../utils/serializeJob');
const { videoQueue } = require('../services/queue');
const { requestCancel } = require('../services/worker');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

// POST /api/jobs
// JSON body: { uploadId, originalFilename, operation, outputFormat, options, retentionHours, deleteOnDownload }
// uploadId comes from a prior upload call — the file is already on disk, so
// this never re-transfers the video bytes. Actual processing happens in the
// BullMQ worker (services/worker.js), not in this request.
async function createJob(req, res) {
  try {
    const { uploadId, originalFilename, operation, outputFormat, options = {}, retentionHours, deleteOnDownload } =
      req.body || {};

    if (!uploadId || typeof uploadId !== 'string') {
      return res.status(400).json({ error: 'uploadId is required (upload the file first)' });
    }

    // path.basename strips any directory traversal attempt from the id.
    const inputPath = path.join(UPLOAD_DIR, path.basename(uploadId));
    try {
      await fs.access(inputPath);
    } catch {
      return res.status(400).json({
        error: 'Upload not found — it may have expired. Please re-select the file.',
      });
    }

    const validationErrors = validateJobInput({ operation, outputFormat, options });
    if (retentionHours !== undefined && (!Number.isFinite(retentionHours) || retentionHours <= 0)) {
      validationErrors.push('retentionHours must be a positive number');
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const inputFormat = path.extname(originalFilename || uploadId).slice(1).toLowerCase();

    const job = await Job.create({
      originalFilename: originalFilename || uploadId,
      storedFilename: path.basename(uploadId),
      inputFormat,
      outputFormat,
      operation,
      options,
      status: 'pending',
      inputPath,
      retentionHours: retentionHours ?? null,
      deleteOnDownload: deleteOnDownload !== false,
    });

    const jobId = job._id.toString();
    // Using the Mongo _id as the Bull job id keeps the two systems in
    // lock-step and makes cross-referencing trivial (no separate id map).
    await videoQueue.add('process-video', { jobId, inputPath }, { jobId });

    return res.status(201).json({ jobId: job._id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/jobs/:id
async function getJobStatus(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(serializeJob(job));
}

// GET /api/jobs?limit=20&cursor=<jobId>&search=<text>&operation=<op>
// Cursor pagination on _id (Mongo ObjectIds sort chronologically, so this
// doubles as a createdAt-descending cursor without a separate index).
async function listJobs(req, res) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { cursor, search, operation } = req.query;

  const filter = {};
  if (operation) filter.operation = operation;
  if (search) filter.originalFilename = { $regex: search.trim(), $options: 'i' };
  if (cursor) filter._id = { $lt: cursor };

  const rows = await Job.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1); // fetch one extra to know if there's a next page

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return res.json({
    jobs: page.map(serializeJob),
    nextCursor: hasMore ? page[page.length - 1]._id : null,
  });
}

// GET /api/jobs/:id/download
async function downloadJob(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job || job.status !== 'done' || !job.outputPath) {
    return res.status(404).json({ error: 'Processed file not available' });
  }
  if (job.expired) {
    return res.status(410).json({ error: 'This file has expired and was removed from the server' });
  }

  const outputPath = job.outputPath;
  res.download(outputPath, async (err) => {
    if (err) {
      // Client aborted or connection dropped — don't delete on a failed transfer.
      console.error(`[job ${job._id}] download error:`, err.message);
      return;
    }
    if (job.deleteOnDownload) {
      await fs.unlink(outputPath).catch(() => {});
      await Job.findByIdAndUpdate(job._id, { expired: true });
    }
  });
}

// POST /api/jobs/:id/cancel
async function cancelJob(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'pending' && job.status !== 'processing') {
    return res.status(400).json({ error: `Cannot cancel a job that is already ${job.status}` });
  }

  const state = requestCancel(String(job._id));
  return res.json({ jobId: job._id, cancelRequested: true, state });
}

// DELETE /api/jobs/:id
// Manual removal from the job log — deletes any files still on disk too.
async function deleteJob(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.outputPath) await fs.unlink(job.outputPath).catch(() => {});
  if (job.inputPath) await fs.unlink(job.inputPath).catch(() => {});
  await Job.findByIdAndDelete(job._id);

  return res.status(204).send();
}

module.exports = { createJob, getJobStatus, listJobs, downloadJob, cancelJob, deleteJob };
