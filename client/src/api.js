const BASE = '/api/jobs';

export async function createJob({
  uploadId,
  originalFilename,
  operation,
  outputFormat,
  options,
  retentionHours,
  deleteOnDownload,
}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      originalFilename,
      operation,
      outputFormat,
      options,
      retentionHours,
      deleteOnDownload,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start job');
  return data; // { jobId, status }
}

export async function getJobStatus(jobId) {
  const res = await fetch(`${BASE}/${jobId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch job status');
  return data; // { jobId, status, progress, errorMessage, downloadUrl }
}

export function downloadUrlFor(jobId) {
  return `${BASE}/${jobId}/download`;
}

export async function listJobs({ cursor, search, operation, limit } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);
  if (operation) params.set('operation', operation);
  if (limit) params.set('limit', limit);

  const res = await fetch(`${BASE}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load job history');
  return data; // { jobs, nextCursor }
}

export async function deleteJob(jobId) {
  const res = await fetch(`${BASE}/${jobId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete job');
  }
}

export async function getConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to load server config');
  return res.json(); // { maxFileSizeMB, supportedFormats, operations, defaultRetentionHours }
}

export async function stageUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload video');
  return data; // { uploadId, originalFilename, durationSeconds, sizeBytes, width, height, codec }
}
