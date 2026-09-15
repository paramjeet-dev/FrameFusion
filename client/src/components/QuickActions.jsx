import { useState } from 'react';

export default function QuickActions({ disabled, metadata, onGenerateThumbnail, onGenerateSpriteSheet, busy }) {
  const [timestamp, setTimestamp] = useState(0);
  const [frameCount, setFrameCount] = useState(16);
  const [columns, setColumns] = useState(4);

  const maxTimestamp = metadata?.durationSeconds ? Math.floor(metadata.durationSeconds) : undefined;

  return (
    <div className="card quick-actions">
      <div className="quick-actions-title">Quick actions</div>

      <div className="quick-action-row">
        <div className="quick-action-field">
          <label htmlFor="thumb-ts">Thumbnail at (sec)</label>
          <input
            id="thumb-ts"
            type="number"
            min="0"
            max={maxTimestamp}
            value={timestamp}
            disabled={disabled}
            onChange={(e) => setTimestamp(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <button className="quick-action-btn" disabled={disabled || busy} onClick={() => onGenerateThumbnail(timestamp)}>
          Generate thumbnail
        </button>
      </div>

      <div className="quick-action-row">
        <div className="quick-action-field">
          <label htmlFor="sprite-frames">Frames</label>
          <input
            id="sprite-frames"
            type="number"
            min="1"
            max="64"
            value={frameCount}
            disabled={disabled}
            onChange={(e) => setFrameCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div className="quick-action-field">
          <label htmlFor="sprite-cols">Columns</label>
          <input
            id="sprite-cols"
            type="number"
            min="1"
            max="16"
            value={columns}
            disabled={disabled}
            onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <button
          className="quick-action-btn"
          disabled={disabled || busy}
          onClick={() => onGenerateSpriteSheet({ frameCount, columns })}
        >
          Generate sprite sheet
        </button>
      </div>
    </div>
  );
}
