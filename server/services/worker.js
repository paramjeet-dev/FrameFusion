const fs = require('fs/promises');
const { Worker } = require('bullmq');
const { connection } = require('./queue');
const { processVideo, generateThumbnail, generateSpriteSheet } = require('./ffmpegService');
const Job = require('../models/Job');
const { serializeJob } = require('../utils/serializeJob');
const jobEvents = require('./jobEvents');
const { onCancelRequested } = require('./cancelChannel');
const logger = require('./logger');

// Tracks the live ffmpeg command per job so a cancel request can kill it.
// This only needs to live in this process now — the API process reaches it
// via the cancelChannel message, not a direct function call.
const activeCommands = new Map();
// jobIds cancelled before or during processing — checked at pickup time and
// used to distinguish "cancelled" from "failed" in the catch block below.
const cancelRequested = new Set();

onCancelRequested((jobId) => {
  cancelRequested.add(jobId);
  const command = activeCommands.get(jobId);
  if (command) command.kill('SIGKILL');
});

async function emitFullUpdate(jobId) {
  const job = await Job.findById(jobId);
  if (job) jobEvents.publish(serializeJob(job));
}

async function runJob(job, jobId) {
  const registerCommand = (command) => activeCommands.set(jobId, command);
  const onProgress = async (percent) => {
    await Job.findByIdAndUpdate(jobId, { progress: percent });
    jobEvents.publish({ jobId, progress: percent, status: 'processing' });
  };

  if (job.kind === 'thumbnail') {
    return generateThumbnail({
      inputPath: job.inputPath,
      timestamp: job.options?.timestamp,
      registerCommand,
      onProgress,
    });
  }

  if (job.kind === 'spritesheet') {
    return generateSpriteSheet({
      inputPath: job.inputPath,
      frameCount: job.options?.frameCount,
      columns: job.options?.columns,
      cellWidth: job.options?.cellWidth,
      outputFormat: job.outputFormat,
      registerCommand,
      onProgress,
    });
  }

  return processVideo({
    inputPath: job.inputPath,
    outputFormat: job.outputFormat,
    options: job.options,
    onProgress,
    registerCommand,
  });
}

const worker = new Worker(
  'video-processing',
  async (bullJob) => {
    const { jobId, inputPath } = bullJob.data;

    // Cancelled while still queued — never actually start ffmpeg.
    if (cancelRequested.has(jobId)) {
      cancelRequested.delete(jobId);
      await Job.findByIdAndUpdate(jobId, { status: 'cancelled', errorMessage: 'Cancelled by user' });
      await emitFullUpdate(jobId);
      fs.unlink(inputPath).catch(() => {});
      return;
    }

    await Job.findByIdAndUpdate(jobId, { status: 'processing', progress: 0 });
    await emitFullUpdate(jobId);
    logger.info({ jobId }, 'job_processing_started');

    const job = await Job.findById(jobId);

    try {
      const outputPath = await runJob(job, jobId);

      activeCommands.delete(jobId);

      await Job.findByIdAndUpdate(jobId, {
        status: 'done',
        progress: 100,
        outputPath,
        completedAt: new Date(),
      });
      await emitFullUpdate(jobId);
      logger.info({ jobId, outputPath }, 'job_completed');
    } catch (err) {
      activeCommands.delete(jobId);
      const wasCancelled = cancelRequested.has(jobId);
      cancelRequested.delete(jobId);

      await Job.findByIdAndUpdate(jobId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        errorMessage: wasCancelled ? 'Cancelled by user' : err.message,
      });
      await emitFullUpdate(jobId);
      logger[wasCancelled ? 'info' : 'error'](
        { jobId, err: err.message },
        wasCancelled ? 'job_cancelled' : 'job_failed'
      );
    } finally {
      fs.unlink(inputPath).catch(() => {});
    }
  },
  { connection }
);

worker.on('error', (err) => logger.error({ err: err.message }, 'worker_error'));

module.exports = { worker };
