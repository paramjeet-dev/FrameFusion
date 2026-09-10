const fs = require('fs/promises');
const path = require('path');
const Job = require('../models/Job');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const PROCESSED_DIR = path.join(__dirname, '..', process.env.PROCESSED_DIR || 'processed');
const MAX_AGE_HOURS = Number(process.env.CLEANUP_MAX_AGE_HOURS || 24);

async function deleteAgedFilesIn(dirPath, maxAgeMs) {
  const deleted = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return deleted; // directory may not exist yet
  }

  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const fullPath = path.join(dirPath, entry);
    try {
      const stat = await fs.stat(fullPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > maxAgeMs) {
        await fs.unlink(fullPath);
        deleted.push(fullPath);
      }
    } catch {
      // File may have been removed concurrently; ignore.
    }
  }
  return deleted;
}

/**
 * Deletes uploaded/processed files older than MAX_AGE_HOURS and marks the
 * corresponding Job records as `expired` so the UI can stop offering downloads.
 */
async function runCleanup() {
  const maxAgeMs = MAX_AGE_HOURS * 60 * 60 * 1000;

  const deletedUploads = await deleteAgedFilesIn(UPLOAD_DIR, maxAgeMs);
  const deletedProcessed = await deleteAgedFilesIn(PROCESSED_DIR, maxAgeMs);

  if (deletedProcessed.length > 0) {
    await Job.updateMany(
      { outputPath: { $in: deletedProcessed } },
      { $set: { expired: true } }
    );
  }

  const total = deletedUploads.length + deletedProcessed.length;
  if (total > 0) {
    console.log(
      `[cleanup] removed ${total} file(s) older than ${MAX_AGE_HOURS}h ` +
        `(${deletedUploads.length} uploads, ${deletedProcessed.length} processed)`
    );
  }
}

module.exports = { runCleanup };
