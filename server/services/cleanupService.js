const fs = require('fs/promises');
const path = require('path');
const Job = require('../models/Job');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const GLOBAL_MAX_AGE_HOURS = Number(process.env.CLEANUP_MAX_AGE_HOURS || 24);

/**
 * Uploads aren't all tied to a live Job (a staged upload that never became a
 * job has no record to check), so this sweep is plain file-age based. Once a
 * job finishes, its own input file is deleted immediately elsewhere — this
 * only catches orphaned staged uploads.
 */
async function cleanupOrphanedUploads(maxAgeMs) {
  let entries;
  try {
    entries = await fs.readdir(UPLOAD_DIR);
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const fullPath = path.join(UPLOAD_DIR, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(fullPath);
        count++;
      }
    } catch {
      // Ignore races (already deleted, etc).
    }
  }
  return count;
}

/**
 * Processed outputs ARE tied to a Job, so retention can be per-job:
 * job.retentionHours overrides the global default when set.
 */
async function cleanupProcessedOutputs(globalMaxAgeMs) {
  const jobs = await Job.find({ status: 'done', expired: false, outputPath: { $ne: null } });

  let count = 0;
  const now = Date.now();
  for (const job of jobs) {
    const completedAtMs = (job.completedAt || job.createdAt).getTime();
    const maxAgeMs =
      job.retentionHours != null ? job.retentionHours * 60 * 60 * 1000 : globalMaxAgeMs;

    if (now - completedAtMs <= maxAgeMs) continue;

    try {
      await fs.unlink(job.outputPath);
    } catch {
      // Already gone (e.g. deleted on download) — still mark expired below.
    }
    job.expired = true;
    await job.save();
    count++;
  }
  return count;
}

async function runCleanup() {
  const maxAgeMs = GLOBAL_MAX_AGE_HOURS * 60 * 60 * 1000;

  const uploadsDeleted = await cleanupOrphanedUploads(maxAgeMs);
  const processedDeleted = await cleanupProcessedOutputs(maxAgeMs);

  const total = uploadsDeleted + processedDeleted;
  if (total > 0) {
    console.log(
      `[cleanup] removed ${total} file(s): ${uploadsDeleted} orphaned uploads, ${processedDeleted} expired outputs`
    );
  }
}

module.exports = { runCleanup };
