import { useRef, useState } from 'react';

const FALLBACK_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];

export default function Dropzone({ file, onSelect, supportedFormats }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const formats = supportedFormats || FALLBACK_FORMATS;

  function handleFiles(fileList) {
    const picked = fileList?.[0];
    if (!picked) return;
    onSelect(picked);
  }

  return (
    <div className="card dropzone-card">
      {!file ? (
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
          <div className="dropzone-label">Drag &amp; Drop or click to Browse</div>
          <div className="dropzone-formats">Supports: {formats.map((f) => f.toUpperCase()).join(', ')}</div>
          <input
            ref={inputRef}
            type="file"
            accept={formats.map((f) => `.${f}`).join(',')}
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        <div className="file-chip">
          {file.name}
          <button aria-label="Remove file" onClick={() => onSelect(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export { FALLBACK_FORMATS };
