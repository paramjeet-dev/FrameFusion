import { downloadUrlFor } from '../api';

const SEGMENTS = 12;

function Meter({ progress, status }) {
  const filledCount = Math.round((progress / 100) * SEGMENTS);
  return (
    <div className="meter">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <div
          key={i}
          className={`meter-seg ${i < filledCount ? (status === 'done' ? 'done' : 'filled') : ''}`}
        />
      ))}
    </div>
  );
}

function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toTimeString().slice(0, 5);
}

export default function JobList({ jobs }) {
  return (
    <div className="log">
      <div className="log-title">Jobs</div>
      {jobs.length === 0 ? (
        <div className="log-empty">No jobs yet. Run one above to see it here.</div>
      ) : (
        jobs
          .slice()
          .reverse()
          .map((job) => (
            <div className="job-row" key={job.jobId}>
              <div className="job-time">{formatClock(job.createdAt)}</div>
              <div className="job-name" title={job.filename}>
                {job.filename}
                <span className="arrow">→</span>
                {job.outputFormat}
              </div>
              <div className="job-op">{job.operation}</div>
              <Meter progress={job.progress} status={job.status} />
              <div className={`job-status ${job.status} ${job.expired ? 'expired' : ''}`}>
                {job.status === 'done' && job.expired ? (
                  'expired'
                ) : job.status === 'done' && job.jobId ? (
                  <a className="download-link" href={downloadUrlFor(job.jobId)}>
                    download
                  </a>
                ) : job.status === 'failed' ? (
                  'failed'
                ) : (
                  `${job.progress}%`
                )}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
