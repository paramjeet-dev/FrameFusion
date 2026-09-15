import { useRef, useState } from 'react';

export default function BatchDropzone({ entries, onFilesSelected, videoFormats }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const formats = videoFormats || [];

  function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected(Array.from(fileList));
  }

  return (
    <div className="card dropzone-card batch-dropzone-card">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="dropzone-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 16V4M12 4L7 9M12 4L17 9"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M4 16V18a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="dropzone-label">Drop multiple videos, or click to browse</div>
        <div className="dropzone-formats">Supports: {formats.map((f) => f.toUpperCase()).join(', ')}</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={formats.map((f) => `.${f}`).join(',')}
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {entries.length > 0 && (
        <div className="batch-file-list">
          {entries.map((entry, i) => (
            <div className="batch-file-row" key={i}>
              <span className="batch-file-name" title={entry.originalFilename}>
                {entry.originalFilename}
              </span>
              <span className={`batch-file-status ${entry.status}`}>
                {entry.status === 'uploading'
                  ? 'uploading…'
                  : entry.status === 'done'
                    ? 'ready'
                    : entry.status === 'error'
                      ? entry.error
                      : 'pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
