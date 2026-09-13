const fs = require('fs/promises');
const { Worker } = require('bullmq');
const { connection } = require('./queue');
const { processVideo } = require('./ffmpegService');
const Job = require('../models/Job');
const { serializeJob } = require('../utils/serializeJob');
const jobEvents = require('./jobEvents');
const { onCancelRequested } = require('./cancelChannel');

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
    console.log(`[job ${jobId}] processing started`);

    const job = await Job.findById(jobId);

    try {
      const outputPath = await processVideo({
        inputPath,
        outputFormat: job.outputFormat,
        options: job.options,
        onProgress: async (percent) => {
          await Job.findByIdAndUpdate(jobId, { progress: percent });
          jobEvents.publish({ jobId, progress: percent, status: 'processing' });
        },
        registerCommand: (command) => activeCommands.set(jobId, command),
      });

      activeCommands.delete(jobId);

      await Job.findByIdAndUpdate(jobId, {
        status: 'done',
        progress: 100,
        outputPath,
        completedAt: new Date(),
      });
      await emitFullUpdate(jobId);
      console.log(`[job ${jobId}] done -> ${outputPath}`);
    } catch (err) {
      activeCommands.delete(jobId);
      const wasCancelled = cancelRequested.has(jobId);
      cancelRequested.delete(jobId);

      await Job.findByIdAndUpdate(jobId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        errorMessage: wasCancelled ? 'Cancelled by user' : err.message,
      });
      await emitFullUpdate(jobId);
      console.error(`[job ${jobId}] ${wasCancelled ? 'cancelled' : 'failed'}:`, err.message);
    } finally {
      fs.unlink(inputPath).catch(() => {});
    }
  },
  { connection }
);

worker.on('error', (err) => console.error('[worker] error:', err.message));

module.exports = { worker };
