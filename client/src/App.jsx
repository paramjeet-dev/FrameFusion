import { useEffect, useRef, useState } from 'react';
import Dropzone from './components/Dropzone';
import OperationPanel from './components/OperationPanel';
import JobList from './components/JobList';
import Toasts from './components/Toasts';
import { cancelJob, chunkedUpload, createJob, deleteJob, getConfig, listJobs } from './api';
import { socket } from './socket';

const OPERATIONS = ['resize', 'compress', 'trim', 'convert'];
const SEARCH_DEBOUNCE_MS = 400;
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

let toastCounter = 0;

export default function App() {
  const [config, setConfig] = useState(null);

  const [operation, setOperation] = useState('compress');
  const [file, setFile] = useState(null);
  const [options, setOptions] = useState({});
  const [outputFormat, setOutputFormat] = useState('mp4');
  const [retentionHours, setRetentionHours] = useState(null);
  const [deleteOnDownload, setDeleteOnDownload] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [jobs, setJobs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [toasts, setToasts] = useState([]);

  const searchDebounce = useRef(null);

  // Server config drives client-side validation limits & format lists so
  // they never drift out of sync with what the backend actually enforces.
  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  function selectOperation(op) {
    setOperation(op);
    setOptions({});
    setError(null);
  }

  function pushToast(message, type = 'info') {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Job status now arrives by push (WebSocket) instead of polling — the
  // worker emits an update whenever a job's status or progress changes, and
  // the server re-broadcasts it to every connected client.
  useEffect(() => {
    function handleUpdate(payload) {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.jobId !== payload.jobId) return j;
          const justFinished = j.status !== payload.status && TERMINAL_STATUSES.includes(payload.status);
          if (justFinished) {
            const messages = {
              done: `${j.filename} finished processing`,
              failed: `${j.filename} failed: ${payload.errorMessage || 'unknown error'}`,
              cancelled: `${j.filename} was cancelled`,
            };
            pushToast(messages[payload.status], payload.status === 'done' ? 'success' : 'error');
          }
          return { ...j, ...payload };
        })
      );
    }

    socket.on('job:update', handleUpdate);
    return () => socket.off('job:update', handleUpdate);
  }, []);

  async function loadJobs({ reset = false, cursor = null } = {}) {
    try {
      const result = await listJobs({
        cursor,
        search: search || undefined,
        operation: operationFilter || undefined,
      });
      setJobs((prev) => (reset ? result.jobs : [...prev, ...result.jobs]));
      setNextCursor(result.nextCursor);
    } catch {
      // Non-fatal — job log just stays empty/stale.
    }
  }

  // Initial load, and reload (from scratch) whenever filters change.
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      loadJobs({ reset: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(searchDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, operationFilter]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await loadJobs({ cursor: nextCursor });
    setLoadingMore(false);
  }

  async function handleDeleteJob(jobId) {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    try {
      await deleteJob(jobId);
    } catch (err) {
      pushToast(`Couldn't delete job: ${err.message}`, 'error');
    }
  }

  async function handleCancelJob(jobId) {
    try {
      await cancelJob(jobId);
      // The worker will emit the 'cancelled' status update over the socket;
      // no need to optimistically patch state here.
    } catch (err) {
      pushToast(`Couldn't cancel: ${err.message}`, 'error');
    }
  }

  async function handleFileSelect(picked) {
    setFile(picked);
    setOptions({});
    setError(null);
    setMetadata(null);
    setUploadProgress(0);
    if (!picked) return;

    // Client-side checks first — no point paying for an upload we know will
    // be rejected server-side.
    if (config) {
      const ext = picked.name.split('.').pop()?.toLowerCase();
      if (!config.supportedFormats.includes(ext)) {
        setError(`Unsupported format ".${ext}". Supported: ${config.supportedFormats.join(', ')}`);
        setFile(null);
        return;
      }
      const maxBytes = config.maxFileSizeMB * 1024 * 1024;
      if (picked.size > maxBytes) {
        setError(`File exceeds the ${config.maxFileSizeMB}MB limit.`);
        setFile(null);
        return;
      }
    }

    setUploading(true);
    try {
      const staged = await chunkedUpload(picked, { onProgress: setUploadProgress });
      setMetadata(staged);
    } catch (err) {
      setFile(null);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function validateOptionsClientSide() {
    if (operation === 'resize') {
      if (!options.width && !options.height) return 'Set at least a width or a height.';
      if (options.width !== undefined && options.width <= 0) return 'Width must be positive.';
      if (options.height !== undefined && options.height <= 0) return 'Height must be positive.';
    }
    if (operation === 'compress') {
      if (options.crf !== undefined && (options.crf < 0 || options.crf > 51)) {
        return 'Quality (CRF) must be between 0 and 51.';
      }
    }
    if (operation === 'trim') {
      if (options.startTime === undefined || !options.duration) {
        return 'Set both start time and duration.';
      }
      if (options.startTime < 0 || options.duration <= 0) {
        return 'Start time and duration must be positive.';
      }
      if (
        metadata?.durationSeconds &&
        options.startTime + options.duration > metadata.durationSeconds + 0.5
      ) {
        return `That runs past the source length (${Math.round(metadata.durationSeconds)}s).`;
      }
    }
    return null;
  }

  async function handleRun() {
    if (!file || !metadata?.uploadId) {
      setError('Choose a video file first.');
      return;
    }
    const clientError = validateOptionsClientSide();
    if (clientError) {
      setError(clientError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { jobId, status } = await createJob({
        uploadId: metadata.uploadId,
        originalFilename: metadata.originalFilename || file.name,
        operation,
        outputFormat,
        options,
        retentionHours: retentionHours ?? undefined,
        deleteOnDownload,
      });
      setJobs((prev) => [
        {
          jobId,
          status,
          progress: 0,
          filename: file.name,
          operation,
          outputFormat,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setFile(null);
      setOptions({});
      setMetadata(null);
      setUploadProgress(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
      <div className="header">
        <h1 className="wordmark">
          Frame<span>Fusion</span>
        </h1>
        <div className="tagline">resize · compress · trim · convert</div>
      </div>

      <div className="deck">
        <div className="rail">
          {OPERATIONS.map((op) => (
            <button
              key={op}
              className={`rail-item ${operation === op ? 'active' : ''}`}
              onClick={() => selectOperation(op)}
            >
              {op}
            </button>
          ))}
        </div>

        <div className="main">
          <Dropzone file={file} onSelect={handleFileSelect} supportedFormats={config?.supportedFormats} />
          {uploading && (
            <div className="upload-progress">
              <div className="field-hint">Uploading… {uploadProgress}%</div>
              <div className="upload-bar">
                <div className="upload-bar-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <OperationPanel
            operation={operation}
            options={options}
            setOptions={setOptions}
            outputFormat={outputFormat}
            setOutputFormat={setOutputFormat}
            metadata={metadata}
            config={config}
            retentionHours={retentionHours}
            setRetentionHours={setRetentionHours}
            deleteOnDownload={deleteOnDownload}
            setDeleteOnDownload={setDeleteOnDownload}
          />

          <div className="run-row">
            {error && <span className="error-text">{error}</span>}
            <button className="run-btn" onClick={handleRun} disabled={submitting || uploading || !metadata?.uploadId}>
              <span className="play-icon" />
              {submitting ? 'Starting…' : 'Run'}
            </button>
          </div>
        </div>
      </div>

      <JobList
        jobs={jobs}
        nextCursor={nextCursor}
        onLoadMore={handleLoadMore}
        loadingMore={loadingMore}
        onDelete={handleDeleteJob}
        onCancel={handleCancelJob}
        search={search}
        onSearchChange={setSearch}
        operationFilter={operationFilter}
        onOperationFilterChange={setOperationFilter}
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
