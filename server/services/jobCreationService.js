const path = require('path');
const fs = require('fs/promises');
const Job = require('../models/Job');
const { videoQueue } = require('./queue');
const { validateJobInput } = require('../utils/validateJobInput');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

class JobCreationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates a single upload reference + export options, creates the Job
 * record, and enqueues it onto BullMQ. Shared by POST /api/jobs and
 * POST /api/jobs/batch so the two code paths can't drift apart.
 */
async function createAndEnqueueJob({
  uploadId,
  originalFilename,
  outputFormat,
  options = {},
  kind = 'export',
  retentionHours,
  deleteOnDownload,
}) {
  if (!uploadId || typeof uploadId !== 'string') {
    throw new JobCreationError('uploadId is required (upload the file first)');
  }

  // path.basename strips any directory traversal attempt from the id.
  const inputPath = path.join(UPLOAD_DIR, path.basename(uploadId));
  try {
    await fs.access(inputPath);
  } catch {
    throw new JobCreationError('Upload not found — it may have expired. Please re-select the file.');
  }

  const validationErrors = validateJobInput({ outputFormat, options, kind });
  if (
    retentionHours !== undefined &&
    retentionHours !== null &&
    (!Number.isFinite(retentionHours) || retentionHours <= 0)
  ) {
    validationErrors.push('retentionHours must be a positive number');
  }
  if (validationErrors.length > 0) {
    throw new JobCreationError(validationErrors.join('; '));
  }

  const inputFormat = path.extname(originalFilename || uploadId).slice(1).toLowerCase();

  const job = await Job.create({
    originalFilename: originalFilename || uploadId,
    storedFilename: path.basename(uploadId),
    inputFormat,
    outputFormat,
    kind,
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

  return job;
}

module.exports = { createAndEnqueueJob, JobCreationError };
