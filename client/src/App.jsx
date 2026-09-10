import { useEffect, useRef, useState } from 'react';
import Dropzone from './components/Dropzone';
import OperationPanel from './components/OperationPanel';
import JobList from './components/JobList';
import { createJob, getJobStatus, listJobs, stageUpload } from './api';

const OPERATIONS = ['resize', 'compress', 'trim', 'convert'];

export default function App() {
  const [operation, setOperation] = useState('compress');
  const [file, setFile] = useState(null);
  const [options, setOptions] = useState({});
  const [outputFormat, setOutputFormat] = useState('mp4');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [metadata, setMetadata] = useState(null); // includes uploadId once staged
  const [uploading, setUploading] = useState(false);

  const pollTimers = useRef({});

  function selectOperation(op) {
    setOperation(op);
    setOptions({});
    setError(null);
  }

  async function handleFileSelect(picked) {
    setFile(picked);
    setOptions({});
    setError(null);
    setMetadata(null);
    if (!picked) return;

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

  // Load job history on mount, and resume polling for anything still in flight.
  useEffect(() => {
    listJobs()
      .then((history) => {
        setJobs(history);
        history
          .filter((j) => j.status === 'pending' || j.status === 'processing')
          .forEach((j) => pollJob(j.jobId));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pollJob(jobId) {
    const timer = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId);
        setJobs((prev) =>
          prev.map((j) => (j.jobId === jobId ? { ...j, ...status } : j))
        );
        if (status.status === 'done' || status.status === 'failed') {
          clearInterval(pollTimers.current[jobId]);
          delete pollTimers.current[jobId];
        }
      } catch {
        clearInterval(pollTimers.current[jobId]);
        delete pollTimers.current[jobId];
      }
    }, 1500);
    pollTimers.current[jobId] = timer;
  }

  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  async function handleRun() {
    if (!file || !metadata?.uploadId) {
      setError('Choose a video file first.');
      return;
    }
    if (operation === 'resize' && !options.width && !options.height) {
      setError('Set at least a width or a height.');
      return;
    }
    if (operation === 'trim' && (options.startTime === undefined || !options.duration)) {
      setError('Set both start time and duration.');
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
      });
      setJobs((prev) => [
        ...prev,
        {
          jobId,
          status,
          progress: 0,
          filename: file.name,
          operation,
          outputFormat,
          createdAt: new Date(),
        },
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
          <Dropzone file={file} onSelect={handleFileSelect} />
          {uploading && <div className="field-hint">Uploading &amp; reading video info…</div>}

          <OperationPanel
            operation={operation}
            options={options}
            setOptions={setOptions}
            outputFormat={outputFormat}
            setOutputFormat={setOutputFormat}
            metadata={metadata}
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

      <JobList jobs={jobs} />
    </div>
  );
}
