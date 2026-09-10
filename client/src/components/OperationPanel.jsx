const OUTPUT_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function OperationPanel({
  operation,
  options,
  setOptions,
  outputFormat,
  setOutputFormat,
  metadata,
}) {
  function update(key, value) {
    setOptions({ ...options, [key]: value });
  }

  return (
    <div className="options">
      {operation === 'resize' && (
        <>
          {metadata?.width && (
            <div className="field-hint">
              Original: {metadata.width}×{metadata.height}
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label htmlFor="width">Width (px)</label>
              <input
                id="width"
                type="number"
                placeholder="1280"
                value={options.width || ''}
                onChange={(e) => update('width', Number(e.target.value) || undefined)}
              />
            </div>
            <div className="field">
              <label htmlFor="height">Height (px)</label>
              <input
                id="height"
                type="number"
                placeholder="720 (optional if width set)"
                value={options.height || ''}
                onChange={(e) => update('height', Number(e.target.value) || undefined)}
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={options.preserveAspectRatio !== false}
              onChange={(e) => update('preserveAspectRatio', e.target.checked)}
            />
            Preserve aspect ratio
          </label>
        </>
      )}

      {operation === 'compress' && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="crf">Quality (CRF, lower = better)</label>
            <input
              id="crf"
              type="number"
              min="0"
              max="51"
              placeholder="28"
              value={options.crf ?? ''}
              onChange={(e) => update('crf', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="preset">Preset</label>
            <select
              id="preset"
              value={options.preset || 'medium'}
              onChange={(e) => update('preset', e.target.value)}
            >
              <option value="ultrafast">ultrafast</option>
              <option value="fast">fast</option>
              <option value="medium">medium</option>
              <option value="slow">slow</option>
            </select>
          </div>
        </div>
      )}

      {operation === 'trim' && (
        <div className="field-row">
          {metadata?.durationSeconds > 0 && (
            <div className="field-hint field-hint-full">
              Source length: {formatDuration(metadata.durationSeconds)}
            </div>
          )}
          <div className="field">
            <label htmlFor="startTime">Start time (sec)</label>
            <input
              id="startTime"
              type="number"
              placeholder="0"
              value={options.startTime ?? ''}
              onChange={(e) => update('startTime', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="duration">Duration (sec)</label>
            <input
              id="duration"
              type="number"
              placeholder="10"
              value={options.duration ?? ''}
              onChange={(e) => update('duration', Number(e.target.value))}
            />
          </div>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="outputFormat">Output format</label>
          <select id="outputFormat" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
            {OUTPUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
