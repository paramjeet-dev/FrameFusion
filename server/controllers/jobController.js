const path = require('path');
const fs = require('fs/promises');
const Job = require('../models/Job');
const { processVideo } = require('../services/ffmpegService');
const { validateJobInput } = require('../utils/validateJobInput');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

// POST /api/jobs
// JSON body: { uploadId, originalFilename, operation, outputFormat, options }
// uploadId comes from a prior POST /api/uploads call — the file is already
// on disk, so this never re-transfers the video bytes.
async function createJob(req, res) {
  try {
    const { uploadId, originalFilename, operation, outputFormat, options = {} } = req.body || {};

    if (!uploadId || typeof uploadId !== 'string') {
      return res.status(400).json({ error: 'uploadId is required (upload the file via POST /api/uploads first)' });
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
    });

    // Fire-and-forget async processing; client polls for status.
    processJobAsync(job._id, inputPath);

    return res.status(201).json({ jobId: job._id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function processJobAsync(jobId, inputPath) {
  try {
    await Job.findByIdAndUpdate(jobId, { status: 'processing', progress: 0 });

    const job = await Job.findById(jobId);

    const outputPath = await processVideo({
      inputPath,
      operation: job.operation,
      outputFormat: job.outputFormat,
      options: job.options,
      onProgress: async (percent) => {
        await Job.findByIdAndUpdate(jobId, { progress: percent });
      },
    });

    await Job.findByIdAndUpdate(jobId, {
      status: 'done',
      progress: 100,
      outputPath,
    });
  } catch (err) {
    await Job.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message,
    });
  } finally {
    // The original upload is no longer needed once processing succeeds or
    // fails — delete it right away rather than waiting for the cleanup job.
    fs.unlink(inputPath).catch(() => {});
  }
}

function serializeJob(job) {
  return {
    jobId: job._id,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    filename: job.originalFilename,
    operation: job.operation,
    outputFormat: job.outputFormat,
    createdAt: job.createdAt,
    expired: job.expired,
    downloadUrl: job.status === 'done' && !job.expired ? `/api/jobs/${job._id}/download` : null,
  };
}

// GET /api/jobs/:id
async function getJobStatus(req, res) {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(serializeJob(job));
}

// GET /api/jobs?limit=50
// Returns recent job history, newest first, so the UI survives a page refresh.
async function listJobs(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const jobs = await Job.find().sort({ createdAt: -1 }).limit(limit);
  return res.json(jobs.map(serializeJob));
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
  return res.download(job.outputPath);
}

module.exports = { createJob, getJobStatus, listJobs, downloadJob };
