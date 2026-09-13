const BASE = '/api/jobs';

export async function createJob({
  uploadId,
  originalFilename,
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

export async function listJobs({ cursor, search, format, limit } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);
  if (format) params.set('format', format);
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
  return res.json(); // { maxFileSizeMB, videoFormats, audioFormats, defaultRetentionHours }
}

export async function stageUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload video');
  return data; // { uploadId, originalFilename, durationSeconds, sizeBytes, width, height, codec }
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per request

// Splits the file into chunks and uploads them one at a time, reporting
// percent progress as it goes. Not resumable across a page reload — see the
// note in server/controllers/uploadController.js — but it does give real
// upload progress and avoids one giant request for large files.
export async function chunkedUpload(file, { onProgress } = {}) {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  const initRes = await fetch('/api/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, totalChunks }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || 'Failed to start upload');
  const { uploadId } = initData;

  let uploadedBytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const res = await fetch(`/api/uploads/${uploadId}/chunk/${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to upload part ${i + 1} of ${totalChunks}`);
    }

    uploadedBytes += chunk.size;
    onProgress?.(Math.round((uploadedBytes / file.size) * 100));
  }

  const completeRes = await fetch(`/api/uploads/${uploadId}/complete`, { method: 'POST' });
  const completeData = await completeRes.json();
  if (!completeRes.ok) throw new Error(completeData.error || 'Failed to finalize upload');
  return completeData; // { uploadId, originalFilename, durationSeconds, sizeBytes, width, height, codec }
}

export async function cancelJob(jobId) {
  const res = await fetch(`${BASE}/${jobId}/cancel`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to cancel job');
  return data;
}
