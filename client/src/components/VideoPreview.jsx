import { useEffect, useRef, useState } from 'react';

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoPreview({ file, metadata }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Grabs an actual frame from the selected file (rather than a generic
  // icon) by seeking a hidden <video> element and drawing it to a canvas.
  useEffect(() => {
    setThumbnailUrl(null);
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    function captureFrame() {
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        // Some browsers/codecs can refuse to read back the canvas — the
        // metadata overlay still renders fine without a thumbnail image.
      }
    }

    function handleLoadedData() {
      // A hair past 0 avoids an all-black first frame on some encodes.
      const seekTo = Math.min(0.5, (video.duration || 1) / 4);
      video.currentTime = seekTo;
    }

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', captureFrame);

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', captureFrame);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!file) {
    return (
      <div className="card preview-card">
        <div className="preview-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 9.5L22 6.5V17.5L16 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span>No video selected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card preview-card">
      {thumbnailUrl && <img className="preview-thumb" src={thumbnailUrl} alt="" />}
      <div className="preview-overlay">
        <div className="preview-meta">
          {metadata?.width ? `${metadata.width} x ${metadata.height}px` : '—'}
          <br />
          {formatDuration(metadata?.durationSeconds)}
        </div>
        <div className="preview-meta right">
          {(metadata?.codec || '').toUpperCase() || '—'}
          <br />
          {file.name}
        </div>
      </div>
    </div>
  );
}
