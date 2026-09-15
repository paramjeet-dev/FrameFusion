// Human-readable summary of what a job actually did, since it's no longer
// a single named "operation" — e.g. "resize · quality 60 · trim".
function summarizeTransforms(options = {}, kind = 'export') {
  if (kind === 'thumbnail') return 'thumbnail';
  if (kind === 'spritesheet') return 'sprite sheet';

  const parts = [];
  if (options.audioOnly) parts.push('audio only');
  if (options.resize) parts.push('resize');
  if (options.quality !== undefined && options.quality < 100) parts.push(`quality ${options.quality}`);
  if (options.trim) parts.push('trim');
  return parts.length > 0 ? parts.join(' · ') : 'convert';
}

function serializeJob(job) {
  return {
    jobId: String(job._id),
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    filename: job.originalFilename,
    kind: job.kind,
    transforms: summarizeTransforms(job.options, job.kind),
    outputFormat: job.outputFormat,
    createdAt: job.createdAt,
    expired: job.expired,
    retentionHours: job.retentionHours,
    deleteOnDownload: job.deleteOnDownload,
    downloadUrl: job.status === 'done' && !job.expired ? `/api/jobs/${job._id}/download` : null,
  };
}

module.exports = { serializeJob, summarizeTransforms };
