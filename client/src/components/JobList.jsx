import { downloadUrlFor } from '../api';

const SEGMENTS = 12;
const OPERATIONS = ['resize', 'compress', 'trim', 'convert'];

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

export default function JobList({
  jobs,
  nextCursor,
  onLoadMore,
  loadingMore,
  onDelete,
  search,
  onSearchChange,
  operationFilter,
  onOperationFilterChange,
}) {
  return (
    <div className="log">
      <div className="log-toolbar">
        <div className="log-title">Jobs</div>
        <input
          className="log-search"
          type="text"
          placeholder="Search filename…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <select value={operationFilter} onChange={(e) => onOperationFilterChange(e.target.value)}>
          <option value="">All operations</option>
          {OPERATIONS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>

      {jobs.length === 0 ? (
        <div className="log-empty">No jobs yet. Run one above to see it here.</div>
      ) : (
        jobs.map((job) => (
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
            <button
              className="job-delete"
              aria-label="Remove job"
              title="Remove from log"
              onClick={() => onDelete(job.jobId)}
            >
              ×
            </button>
          </div>
        ))
      )}

      {nextCursor && (
        <button className="load-more-btn" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
