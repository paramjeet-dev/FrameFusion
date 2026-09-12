const { SUPPORTED_FORMATS } = require('../models/Job');

/**
 * Returns an array of human-readable error messages (empty if valid).
 * `options.resize` and `options.trim` are optional — a job with neither is
 * just a quality/format pass. `options.quality` always applies (defaults to
 * 100 if omitted).
 */
function validateJobInput({ outputFormat, options = {} }) {
  const errors = [];

  if (!SUPPORTED_FORMATS.includes(outputFormat)) {
    errors.push(`outputFormat must be one of: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  const { resize, quality, trim } = options;

  if (resize) {
    const { width, height } = resize;
    if (!width && !height) {
      errors.push('resize requires at least one of width or height');
    }
    if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
      errors.push('resize width must be a positive number');
    }
    if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
      errors.push('resize height must be a positive number');
    }
  }

  if (quality !== undefined && (!Number.isFinite(quality) || quality < 0 || quality > 100)) {
    errors.push('quality must be a number between 0 and 100');
  }

  if (trim) {
    const { startTime, duration } = trim;
    if (startTime === undefined || !Number.isFinite(startTime) || startTime < 0) {
      errors.push('trim startTime must be a non-negative number');
    }
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
      errors.push('trim duration must be a positive number');
    }
  }

  return errors;
}

module.exports = { validateJobInput };
