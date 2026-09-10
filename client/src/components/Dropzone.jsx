import { useRef, useState } from 'react';

const SUPPORTED_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];

export default function Dropzone({ file, onSelect }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(fileList) {
    const picked = fileList?.[0];
    if (!picked) return;
    onSelect(picked);
  }

  return (
    <div>
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
          <div className="dropzone-label">Drop a video here, or click to browse</div>
          <div className="dropzone-formats">
            {SUPPORTED_FORMATS.map((f) => f.toUpperCase()).join(' · ')}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED_FORMATS.map((f) => `.${f}`).join(',')}
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

export { SUPPORTED_FORMATS };
