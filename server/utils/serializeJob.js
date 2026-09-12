function serializeJob(job) {
  return {
    jobId: String(job._id),
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    filename: job.originalFilename,
    operation: job.operation,
    outputFormat: job.outputFormat,
    createdAt: job.createdAt,
    expired: job.expired,
    retentionHours: job.retentionHours,
    deleteOnDownload: job.deleteOnDownload,
    downloadUrl: job.status === 'done' && !job.expired ? `/api/jobs/${job._id}/download` : null,
  };
}

module.exports = { serializeJob };
