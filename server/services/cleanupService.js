const fs = require('fs/promises');
const path = require('path');
const Job = require('../models/Job');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const CHUNKS_DIR = path.join(UPLOAD_DIR, 'chunks');
const GLOBAL_MAX_AGE_HOURS = Number(process.env.CLEANUP_MAX_AGE_HOURS || 24);
const STALE_CHUNK_SESSION_HOURS = 6; // abandoned mid-upload sessions

/**
 * Uploads aren't all tied to a live Job (a staged upload that never became a
 * job has no record to check), so this sweep is plain file-age based. Once a
 * job finishes, its own input file is deleted immediately elsewhere — this
 * only catches orphaned staged uploads. The `chunks/` subdirectory is
 * skipped here and handled separately since fs.unlink can't remove dirs.
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
    if (entry === '.gitkeep' || entry === 'chunks') continue;
    const fullPath = path.join(UPLOAD_DIR, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() && Date.now() - stat.mtimeMs > maxAgeMs) {
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
 * Chunked uploads that were started but never completed (browser closed,
 * connection dropped) leave a directory of .part files behind. Swept much
 * sooner than regular uploads since there's no reason to keep a dead session.
 */
async function cleanupStaleChunkSessions(maxAgeMs) {
  let sessions;
  try {
    sessions = await fs.readdir(CHUNKS_DIR);
  } catch {
    return 0;
  }

  let count = 0;
  for (const sessionId of sessions) {
    const sessionDir = path.join(CHUNKS_DIR, sessionId);
    try {
      const stat = await fs.stat(sessionDir);
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.rm(sessionDir, { recursive: true, force: true });
        count++;
      }
    } catch {
      // Ignore races.
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
  const staleChunkMs = STALE_CHUNK_SESSION_HOURS * 60 * 60 * 1000;

  const uploadsDeleted = await cleanupOrphanedUploads(maxAgeMs);
  const chunkSessionsDeleted = await cleanupStaleChunkSessions(staleChunkMs);
  const processedDeleted = await cleanupProcessedOutputs(maxAgeMs);

  const total = uploadsDeleted + chunkSessionsDeleted + processedDeleted;
  if (total > 0) {
    console.log(
      `[cleanup] removed ${total} item(s): ${uploadsDeleted} orphaned uploads, ` +
        `${chunkSessionsDeleted} stale chunk sessions, ${processedDeleted} expired outputs`
    );
  }
}

module.exports = { runCleanup };
