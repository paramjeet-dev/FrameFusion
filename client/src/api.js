const BASE = '/api/jobs';

export async function createJob({ uploadId, originalFilename, operation, outputFormat, options }) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, originalFilename, operation, outputFormat, options }),
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

export async function listJobs() {
  const res = await fetch(BASE);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load job history');
  return data;
}

export async function stageUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload video');
  return data; // { uploadId, originalFilename, durationSeconds, sizeBytes, width, height, codec }
}
