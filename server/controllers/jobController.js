const fs = require('fs/promises');
const Job = require('../models/Job');
const { serializeJob } = require('../utils/serializeJob');
const { requestCancel } = require('../services/cancelChannel');
const { createAndEnqueueJob, JobCreationError } = require('../services/jobCreationService');
const logger = require('../services/logger');

const MAX_BATCH_SIZE = 20;

// POST /api/jobs
// JSON body: { uploadId, originalFilename, outputFormat, options, kind, retentionHours, deleteOnDownload }
// uploadId comes from a prior upload call — the file is already on disk, so
// this never re-transfers the video bytes. Actual processing happens in the
// BullMQ worker (services/worker.js), not in this request. `options` can
// combine resize/quality/trim in any mix — see models/Job.js.
async function createJob(req, res) {
  try {
    const job = await createAndEnqueueJob(req.body || {});
    return res.status(201).json({ jobId: job._id, status: job.status });
  } catch (err) {
    const status = err instanceof JobCreationError ? err.status : 500;
    if (status === 500) logger.error({ err: err.message }, 'job_creation_failed');
    return res.status(status).json({ error: err.message });
  }
}

// POST /api/jobs/batch
// JSON body: { uploads: [{ uploadId, originalFilename }, ...], outputFormat, options, kind, retentionHours, deleteOnDownload }
// Creates one job per upload, all sharing the same export settings. Each
// upload succeeds or fails independently — one bad file in the batch
// doesn't block the rest. Reuses the exact same per-file logic as the
// single-job endpoint via jobCreationService, so the two can't drift apart.
async function createBatchJobs(req, res) {
  const { uploads, outputFormat, options, kind, retentionHours, deleteOnDownload } = req.body || {};

  if (!Array.isArray(uploads) || uploads.length === 0) {
    return res.status(400).json({ error: 'uploads must be a non-empty array of { uploadId, originalFilename }' });
  }
  if (uploads.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ error: `Batch size is limited to ${MAX_BATCH_SIZE} files at a time` });
  }

  const results = [];
  for (const upload of uploads) {
    try {
      const job = await createAndEnqueueJob({
        uploadId: upload?.uploadId,
        originalFilename: upload?.originalFilename,
        outputFormat,
        options,
        kind,
        retentionHours,
        deleteOnDownload,
      });
      results.push({ uploadId: upload?.uploadId, jobId: job._id, status: job.status });
    } catch (err) {
      if (!(err instanceof JobCreationError)) logger.error({ err: err.message }, 'batch_job_creation_failed');
      results.push({ uploadId: upload?.uploadId, error: err.message });
    }
  }

  const anySucceeded = results.some((r) => r.jobId);
  logger.info(
    { total: uploads.length, succeeded: results.filter((r) => r.jobId).length },
    'batch_job_creation_completed'
  );
  return res.status(anySucceeded ? 201 : 400).json({ jobs: results });
}

// GET /api/jobs/:id
async function getJobStatus(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(serializeJob(job));
}

// GET /api/jobs?limit=20&cursor=<jobId>&search=<text>&format=<ext>
// Cursor pagination on _id (Mongo ObjectIds sort chronologically, so this
// doubles as a createdAt-descending cursor without a separate index).
async function listJobs(req, res) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { cursor, search, format } = req.query;

  const filter = {};
  if (format) filter.outputFormat = format;
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
      logger.error({ jobId: job._id, err: err.message }, 'download_error');
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

  // requestCancel just publishes a message now (the worker may be a
  // separate process), so we can't get a synchronous active/queued answer
  // back from it — but the job's own status already tells us the same thing.
  requestCancel(String(job._id));
  const state = job.status === 'processing' ? 'active' : 'queued';
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

module.exports = { createJob, createBatchJobs, getJobStatus, listJobs, downloadJob, cancelJob, deleteJob };
