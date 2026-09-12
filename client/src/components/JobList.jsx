import { downloadUrlFor } from '../api';

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
  onCancel,
  search,
  onSearchChange,
  formatFilter,
  onFormatFilterChange,
  supportedFormats,
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
        <select value={formatFilter} onChange={(e) => onFormatFilterChange(e.target.value)}>
          <option value="">All formats</option>
          {(supportedFormats || []).map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
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
              <div className="job-transforms">{job.transforms}</div>
            </div>
            <div className="meter">
              <div
                className={`meter-fill ${job.status === 'done' ? 'done' : ''}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <div className={`job-status ${job.status} ${job.expired ? 'expired' : ''}`}>
              {job.status === 'done' && job.expired ? (
                'expired'
              ) : job.status === 'done' && job.jobId ? (
                <a className="download-link" href={downloadUrlFor(job.jobId)}>
                  download
                </a>
              ) : job.status === 'failed' ? (
                'failed'
              ) : job.status === 'cancelled' ? (
                'cancelled'
              ) : (
                <span className="inflight">
                  {job.progress}%
                  <button className="cancel-link" onClick={() => onCancel(job.jobId)}>
                    cancel
                  </button>
                </span>
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
