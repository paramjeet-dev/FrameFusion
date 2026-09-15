import { useEffect, useRef, useState } from 'react';
import Dropzone from './components/Dropzone';
import BatchDropzone from './components/BatchDropzone';
import VideoPreview from './components/VideoPreview';
import ExportControls, { RATIOS } from './components/ExportControls';
import QuickActions from './components/QuickActions';
import JobList from './components/JobList';
import Toasts from './components/Toasts';
import ThemeToggle from './components/ThemeToggle';
import { cancelJob, chunkedUpload, createBatchJob, createJob, deleteJob, getConfig, listJobs } from './api';
import { socket } from './socket';

const SEARCH_DEBOUNCE_MS = 400;
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

let toastCounter = 0;

function secondsToHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

function hmsToSeconds({ h, m, s }) {
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('framefusion-theme');
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('framefusion-theme', theme);
  }, [theme]);

  const [file, setFile] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [resizeWidth, setResizeWidth] = useState(0);
  const [resizeHeight, setResizeHeight] = useState(0);
  const [ratio, setRatio] = useState('variable');
  const [quality, setQuality] = useState(100);
  const [trimStart, setTrimStart] = useState({ h: 0, m: 0, s: 0 });
  const [trimEnd, setTrimEnd] = useState({ h: 0, m: 0, s: 0 });
  const [outputFormat, setOutputFormat] = useState('mp4');
  const [audioOnly, setAudioOnly] = useState(false);
  const [retentionHours, setRetentionHours] = useState(null);
  const [deleteOnDownload, setDeleteOnDownload] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [batchMode, setBatchMode] = useState(false);
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchUploading, setBatchUploading] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [toasts, setToasts] = useState([]);

  const searchDebounce = useRef(null);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfig(c);
        setOutputFormat((prev) => (c.videoFormats.includes(prev) ? prev : c.videoFormats[0]));
      })
      .catch(() => setConfig(null));
  }, []);

  function pushToast(message, type = 'info') {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Job status arrives by WebSocket push, not polling.
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
        format: formatFilter || undefined,
      });
      setJobs((prev) => (reset ? result.jobs : [...prev, ...result.jobs]));
      setNextCursor(result.nextCursor);
    } catch {
      // Non-fatal — job log just stays empty/stale.
    }
  }

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => loadJobs({ reset: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(searchDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, formatFilter]);

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
    } catch (err) {
      pushToast(`Couldn't cancel: ${err.message}`, 'error');
    }
  }

  function handleToggleBatchMode() {
    setBatchMode((prev) => !prev);
    setFile(null);
    setMetadata(null);
    setBatchFiles([]);
    setError(null);
  }

  async function handleBatchFilesSelected(files) {
    setError(null);
    const entries = files.map((f) => ({
      file: f,
      uploadId: null,
      originalFilename: f.name,
      status: 'pending',
      error: null,
    }));
    setBatchFiles(entries);
    setBatchUploading(true);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (config) {
        const ext = entry.file.name.split('.').pop()?.toLowerCase();
        if (!config.videoFormats.includes(ext)) {
          setBatchFiles((prev) =>
            prev.map((e, idx) => (idx === i ? { ...e, status: 'error', error: `Unsupported format .${ext}` } : e))
          );
          continue;
        }
        const maxBytes = config.maxFileSizeMB * 1024 * 1024;
        if (entry.file.size > maxBytes) {
          setBatchFiles((prev) =>
            prev.map((e, idx) => (idx === i ? { ...e, status: 'error', error: `Exceeds ${config.maxFileSizeMB}MB` } : e))
          );
          continue;
        }
      }

      setBatchFiles((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'uploading' } : e)));
      try {
        const staged = await chunkedUpload(entry.file);
        setBatchFiles((prev) =>
          prev.map((e, idx) =>
            idx === i
              ? { ...e, status: 'done', uploadId: staged.uploadId, originalFilename: staged.originalFilename }
              : e
          )
        );
      } catch (err) {
        setBatchFiles((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'error', error: err.message } : e)));
      }
    }

    setBatchUploading(false);
  }

  async function handleRunBatch() {
    const ready = batchFiles.filter((e) => e.status === 'done' && e.uploadId);
    if (ready.length === 0) {
      setError('No successfully uploaded files to process yet.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { jobs: results } = await createBatchJob({
        uploads: ready.map((e) => ({ uploadId: e.uploadId, originalFilename: e.originalFilename })),
        outputFormat,
        options: { quality, audioOnly },
        retentionHours: retentionHours ?? undefined,
        deleteOnDownload,
      });

      const newJobs = results
        .filter((r) => r.jobId)
        .map((r) => ({
          jobId: r.jobId,
          status: r.status,
          progress: 0,
          filename: ready.find((e) => e.uploadId === r.uploadId)?.originalFilename || r.uploadId,
          transforms:
            [audioOnly && 'audio only', quality < 100 && `quality ${quality}`].filter(Boolean).join(' · ') ||
            'convert',
          outputFormat,
          createdAt: new Date().toISOString(),
        }));
      setJobs((prev) => [...newJobs, ...prev]);

      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        pushToast(`${failed.length} of ${results.length} file(s) failed to queue`, 'error');
      }

      setBatchFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateThumbnail(timestamp) {
    if (!metadata?.uploadId) return;
    try {
      const { jobId, status } = await createJob({
        uploadId: metadata.uploadId,
        originalFilename: metadata.originalFilename || file.name,
        outputFormat: 'jpg',
        kind: 'thumbnail',
        options: { timestamp },
      });
      setJobs((prev) => [
        {
          jobId,
          status,
          progress: 0,
          filename: file.name,
          transforms: 'thumbnail',
          outputFormat: 'jpg',
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      pushToast(`Couldn't generate thumbnail: ${err.message}`, 'error');
    }
  }

  async function handleGenerateSpriteSheet({ frameCount, columns }) {
    if (!metadata?.uploadId) return;
    try {
      const { jobId, status } = await createJob({
        uploadId: metadata.uploadId,
        originalFilename: metadata.originalFilename || file.name,
        outputFormat: 'jpg',
        kind: 'spritesheet',
        options: { frameCount, columns },
      });
      setJobs((prev) => [
        {
          jobId,
          status,
          progress: 0,
          filename: file.name,
          transforms: 'sprite sheet',
          outputFormat: 'jpg',
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      pushToast(`Couldn't generate sprite sheet: ${err.message}`, 'error');
    }
  }

  function resetExportOptions(meta) {
    setResizeWidth(meta.width || 0);
    setResizeHeight(meta.height || 0);
    setRatio('variable');
    setQuality(100);
    setAudioOnly(false);
    setTrimStart({ h: 0, m: 0, s: 0 });
    setTrimEnd(secondsToHMS(meta.durationSeconds));
  }

  function handleAudioOnlyChange(next) {
    setAudioOnly(next);
    // Switch the format dropdown to a sensible default in the new list
    // rather than leaving it pointed at a format that's no longer valid.
    if (config) {
      setOutputFormat(next ? config.audioFormats[0] : config.videoFormats[0]);
    }
  }

  async function handleFileSelect(picked) {
    setFile(picked);
    setError(null);
    setMetadata(null);
    setUploadProgress(0);
    if (!picked) return;

    if (config) {
      const ext = picked.name.split('.').pop()?.toLowerCase();
      if (!config.videoFormats.includes(ext)) {
        setError(`Unsupported format ".${ext}". Supported: ${config.videoFormats.join(', ')}`);
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
      resetExportOptions(staged);
    } catch (err) {
      setFile(null);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Keeping width/height in sync with whichever aspect ratio is active is
  // the one bit of real logic in this screen — everything else is a plain
  // controlled input.
  function handleWidthChange(newWidth) {
    setResizeWidth(newWidth);
    if (ratio !== 'variable') {
      setResizeHeight(Math.round(newWidth / RATIOS[ratio]));
    } else if (metadata?.width && metadata?.height) {
      setResizeHeight(Math.round((newWidth * metadata.height) / metadata.width));
    }
  }

  function handleHeightChange(newHeight) {
    setResizeHeight(newHeight);
    if (ratio === 'variable' && metadata?.width && metadata?.height) {
      setResizeWidth(Math.round((newHeight * metadata.width) / metadata.height));
    }
  }

  function handleRatioChange(newRatio) {
    setRatio(newRatio);
    if (newRatio !== 'variable') {
      setResizeHeight(Math.round(resizeWidth / RATIOS[newRatio]));
    } else if (metadata?.width && metadata?.height) {
      setResizeHeight(Math.round((resizeWidth * metadata.height) / metadata.width));
    }
  }

  function validateClientSide() {
    if (!audioOnly && (!resizeWidth || !resizeHeight)) return 'Resolution must be greater than zero.';
    if (quality < 0 || quality > 100) return 'Quality must be between 0 and 100.';

    const startSeconds = hmsToSeconds(trimStart);
    const endSeconds = hmsToSeconds(trimEnd);
    if (endSeconds <= startSeconds) return 'Duration end must be after the start.';
    if (metadata?.durationSeconds && endSeconds > metadata.durationSeconds + 0.5) {
      return `That runs past the source length (${Math.round(metadata.durationSeconds)}s).`;
    }
    return null;
  }

  async function handleRun() {
    if (!file || !metadata?.uploadId) {
      setError('Choose a video file first.');
      return;
    }
    const clientError = validateClientSide();
    if (clientError) {
      setError(clientError);
      return;
    }

    const resizeChanged =
      !audioOnly && (resizeWidth !== metadata.width || resizeHeight !== metadata.height);
    const startSeconds = hmsToSeconds(trimStart);
    const endSeconds = hmsToSeconds(trimEnd);
    const trimChanged =
      startSeconds > 0.01 || (metadata.durationSeconds && Math.abs(endSeconds - metadata.durationSeconds) > 0.5);

    const options = {
      resize: resizeChanged
        ? { width: resizeWidth, height: resizeHeight, preserveAspectRatio: ratio === 'variable' }
        : null,
      quality,
      trim: trimChanged ? { startTime: startSeconds, duration: endSeconds - startSeconds } : null,
      audioOnly,
    };

    setSubmitting(true);
    setError(null);
    try {
      const { jobId, status } = await createJob({
        uploadId: metadata.uploadId,
        originalFilename: metadata.originalFilename || file.name,
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
          transforms:
            [
              options.audioOnly && 'audio only',
              options.resize && 'resize',
              options.quality < 100 && `quality ${options.quality}`,
              options.trim && 'trim',
            ]
              .filter(Boolean)
              .join(' · ') || 'convert',
          outputFormat,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setFile(null);
      setMetadata(null);
      setUploadProgress(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canRun = Boolean(file && metadata?.uploadId) && !submitting && !uploading;

  return (
    <div className="app">
      <div className="header">
        <div className="logo-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 5l16 7-16 7V5z" fill="#fff" />
          </svg>
        </div>
        <h1 className="wordmark">
          Frame<span>Fusion</span>
        </h1>
        <div className="tagline">resize · quality · trim · convert — one export</div>
        <button className="batch-toggle" onClick={handleToggleBatchMode}>
          {batchMode ? 'Single file' : 'Batch mode'}
        </button>
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      </div>

      <div className="top-grid">
        {batchMode ? (
          <div className="card batch-summary-card">
            <div className="batch-summary-title">
              {batchFiles.length} file{batchFiles.length !== 1 ? 's' : ''} selected
            </div>
            <div className="batch-summary-sub">
              {batchFiles.filter((e) => e.status === 'done').length} ready ·{' '}
              {batchFiles.filter((e) => e.status === 'error').length} failed
            </div>
          </div>
        ) : (
          <VideoPreview file={file} metadata={metadata} />
        )}

        {batchMode ? (
          <BatchDropzone
            entries={batchFiles}
            onFilesSelected={handleBatchFilesSelected}
            videoFormats={config?.videoFormats}
          />
        ) : (
          <Dropzone file={file} onSelect={handleFileSelect} videoFormats={config?.videoFormats} />
        )}
      </div>

      <ExportControls
        disabled={batchMode ? batchFiles.length === 0 : !file}
        batchMode={batchMode}
        saveLabel={batchMode ? `Save all (${batchFiles.filter((e) => e.status === 'done').length})` : undefined}
        resizeWidth={resizeWidth}
        resizeHeight={resizeHeight}
        onWidthChange={handleWidthChange}
        onHeightChange={handleHeightChange}
        ratio={ratio}
        onRatioChange={handleRatioChange}
        quality={quality}
        setQuality={setQuality}
        trimStart={trimStart}
        setTrimStart={setTrimStart}
        trimEnd={trimEnd}
        setTrimEnd={setTrimEnd}
        outputFormat={outputFormat}
        setOutputFormat={setOutputFormat}
        audioOnly={audioOnly}
        onAudioOnlyChange={handleAudioOnlyChange}
        config={config}
        retentionHours={retentionHours}
        setRetentionHours={setRetentionHours}
        deleteOnDownload={deleteOnDownload}
        setDeleteOnDownload={setDeleteOnDownload}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        uploading={uploading}
        uploadProgress={uploadProgress}
        submitting={submitting}
        error={error}
        onRun={batchMode ? handleRunBatch : handleRun}
        canRun={
          batchMode
            ? batchFiles.some((e) => e.status === 'done') && !submitting && !batchUploading
            : canRun
        }
      />

      {!batchMode && (
        <QuickActions
          disabled={!file || !metadata?.uploadId}
          metadata={metadata}
          onGenerateThumbnail={handleGenerateThumbnail}
          onGenerateSpriteSheet={handleGenerateSpriteSheet}
          busy={submitting}
        />
      )}

      <JobList
        jobs={jobs}
        nextCursor={nextCursor}
        onLoadMore={handleLoadMore}
        loadingMore={loadingMore}
        onDelete={handleDeleteJob}
        onCancel={handleCancelJob}
        search={search}
        onSearchChange={setSearch}
        formatFilter={formatFilter}
        onFormatFilterChange={setFormatFilter}
        supportedFormats={
          config ? [...config.videoFormats, 'gif', ...config.audioFormats, ...config.imageFormats] : undefined
        }
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
