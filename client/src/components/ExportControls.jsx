const FALLBACK_VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];
const FALLBACK_AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac'];
export const RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4 };

function InfoIcon() {
  return <span className="info-icon">i</span>;
}

function NumberBox({ value, onChange, max, disabled }) {
  return (
    <input
      type="number"
      min="0"
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
    />
  );
}

export default function ExportControls({
  disabled,
  batchMode,
  saveLabel,
  resizeWidth,
  resizeHeight,
  onWidthChange,
  onHeightChange,
  ratio,
  onRatioChange,
  quality,
  setQuality,
  trimStart,
  setTrimStart,
  trimEnd,
  setTrimEnd,
  outputFormat,
  setOutputFormat,
  audioOnly,
  onAudioOnlyChange,
  config,
  retentionHours,
  setRetentionHours,
  deleteOnDownload,
  setDeleteOnDownload,
  showAdvanced,
  setShowAdvanced,
  uploading,
  uploadProgress,
  submitting,
  error,
  onRun,
  canRun,
}) {
  const outputFormats = audioOnly
    ? config?.audioFormats || FALLBACK_AUDIO_FORMATS
    : [...(config?.videoFormats || FALLBACK_VIDEO_FORMATS), 'gif'];
  const defaultRetention = config?.defaultRetentionHours || 24;
  const resolutionDisabled = disabled || audioOnly || batchMode;
  const durationDisabled = disabled || batchMode;

  return (
    <div className="controls-grid">
      {/* Left: resolution / quality / duration */}
      <div className="card controls-card">
        <div className="field-row-icon">
          <InfoIcon />
          <div className="field-icon-content">
            <div className="field-icon-label">Resolution</div>
            {batchMode && <div className="field-note">Not available in batch mode</div>}
            <div className="dimension-row">
              <NumberBox value={resizeWidth} onChange={onWidthChange} disabled={resolutionDisabled} />
              <span className="dimension-x">x</span>
              <NumberBox
                value={resizeHeight}
                onChange={onHeightChange}
                disabled={resolutionDisabled || ratio !== 'variable'}
              />
            </div>
          </div>
        </div>

        <div className="field-row-icon">
          <InfoIcon />
          <div className="field-icon-content">
            <div className="field-icon-label">{audioOnly ? 'Audio quality' : 'Quality'}</div>
            <div className="quality-row">
              <input
                className="quality-slider"
                type="range"
                min="0"
                max="100"
                value={quality}
                disabled={disabled}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
              <span className="quality-value">{quality}%</span>
            </div>
          </div>
        </div>

        <div className="field-row-icon">
          <InfoIcon />
          <div className="field-icon-content">
            <div className="field-icon-label">Duration</div>
            {batchMode && <div className="field-note">Not available in batch mode</div>}
            <div className="duration-row">
              <div className="duration-group">
                <NumberBox value={trimStart.h} onChange={(v) => setTrimStart({ ...trimStart, h: v })} disabled={durationDisabled} />
                <span className="duration-sep">:</span>
                <NumberBox value={trimStart.m} onChange={(v) => setTrimStart({ ...trimStart, m: v })} max={59} disabled={durationDisabled} />
                <span className="duration-sep">:</span>
                <NumberBox value={trimStart.s} onChange={(v) => setTrimStart({ ...trimStart, s: v })} max={59} disabled={durationDisabled} />
              </div>
              <span className="duration-to">to</span>
              <div className="duration-group">
                <NumberBox value={trimEnd.h} onChange={(v) => setTrimEnd({ ...trimEnd, h: v })} disabled={durationDisabled} />
                <span className="duration-sep">:</span>
                <NumberBox value={trimEnd.m} onChange={(v) => setTrimEnd({ ...trimEnd, m: v })} max={59} disabled={durationDisabled} />
                <span className="duration-sep">:</span>
                <NumberBox value={trimEnd.s} onChange={(v) => setTrimEnd({ ...trimEnd, s: v })} max={59} disabled={durationDisabled} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: progress / format / ratio / save / advanced */}
      <div className="card controls-card">
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: uploading ? `${uploadProgress}%` : submitting ? '100%' : '0%' }}
          />
        </div>

        <div className="select-row">
          <div className="select-field">
            <label htmlFor="outputFormat">Format</label>
            <select id="outputFormat" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
              {outputFormats.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="select-field">
            <label htmlFor="ratio">Ratio</label>
            <select id="ratio" value={ratio} onChange={(e) => onRatioChange(e.target.value)} disabled={audioOnly || batchMode}>
              <option value="variable">Variable</option>
              {Object.keys(RATIOS).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={audioOnly} onChange={(e) => onAudioOnlyChange(e.target.checked)} />
          Audio only (strip video, export audio track)
        </label>

        <button
          className="advanced-toggle"
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
        </button>

        {showAdvanced && (
          <div className="advanced-panel">
            <div className="select-field">
              <label htmlFor="retention">Keep processed file for</label>
              <select
                id="retention"
                value={retentionHours ?? 'default'}
                onChange={(e) => setRetentionHours(e.target.value === 'default' ? null : Number(e.target.value))}
              >
                <option value="default">Default ({defaultRetention}h)</option>
                <option value="1">1 hour</option>
                <option value="24">24 hours</option>
                <option value="168">7 days</option>
              </select>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={deleteOnDownload}
                onChange={(e) => setDeleteOnDownload(e.target.checked)}
              />
              Delete file immediately after I download it
            </label>
          </div>
        )}

        <div className="save-row">
          {error && <span className="error-text">{error}</span>}
          <button className="save-btn" onClick={onRun} disabled={!canRun}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M8 3v5h7V3M8 21v-7h8v7" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            {submitting ? 'Starting…' : saveLabel || 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
