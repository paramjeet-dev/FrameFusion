import { useEffect, useRef, useState } from 'react';
import Dropzone from './components/Dropzone';
import OperationPanel from './components/OperationPanel';
import JobList from './components/JobList';
import Toasts from './components/Toasts';
import { createJob, deleteJob, getConfig, getJobStatus, listJobs, stageUpload } from './api';

const OPERATIONS = ['resize', 'compress', 'trim', 'convert'];
const POLL_INTERVAL_MS = 1500;
const SEARCH_DEBOUNCE_MS = 400;

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

  const [jobs, setJobs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [toasts, setToasts] = useState([]);

  const pollTimers = useRef({});
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

  function pollJob(jobId) {
    const timer = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId);
        setJobs((prev) =>
          prev.map((j) => {
            if (j.jobId !== jobId) return j;
            if (j.status !== status.status && (status.status === 'done' || status.status === 'failed')) {
              pushToast(
                status.status === 'done'
                  ? `${j.filename} finished processing`
                  : `${j.filename} failed: ${status.errorMessage || 'unknown error'}`,
                status.status === 'done' ? 'success' : 'error'
              );
            }
            return { ...j, ...status };
          })
        );
        if (status.status === 'done' || status.status === 'failed') {
          clearInterval(pollTimers.current[jobId]);
          delete pollTimers.current[jobId];
        }
      } catch {
        clearInterval(pollTimers.current[jobId]);
        delete pollTimers.current[jobId];
      }
    }, POLL_INTERVAL_MS);
    pollTimers.current[jobId] = timer;
  }

  async function loadJobs({ reset = false, cursor = null } = {}) {
    try {
      const result = await listJobs({
        cursor,
        search: search || undefined,
        operation: operationFilter || undefined,
      });
      setJobs((prev) => (reset ? result.jobs : [...prev, ...result.jobs]));
      setNextCursor(result.nextCursor);

      if (reset) {
        result.jobs
          .filter((j) => j.status === 'pending' || j.status === 'processing')
          .forEach((j) => pollJob(j.jobId));
      }
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

  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await loadJobs({ cursor: nextCursor });
    setLoadingMore(false);
  }

  async function handleDeleteJob(jobId) {
    clearInterval(pollTimers.current[jobId]);
    delete pollTimers.current[jobId];
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    try {
      await deleteJob(jobId);
    } catch (err) {
      pushToast(`Couldn't delete job: ${err.message}`, 'error');
    }
  }

  async function handleFileSelect(picked) {
    setFile(picked);
    setOptions({});
    setError(null);
    setMetadata(null);
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
      const staged = await stageUpload(picked);
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
      pollJob(jobId);
      setFile(null);
      setOptions({});
      setMetadata(null);
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
          {uploading && <div className="field-hint">Uploading &amp; reading video info…</div>}

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
        search={search}
        onSearchChange={setSearch}
        operationFilter={operationFilter}
        onOperationFilterChange={setOperationFilter}
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
