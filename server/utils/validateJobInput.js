const { OPERATIONS, SUPPORTED_FORMATS } = require('../models/Job');

/**
 * Returns an array of human-readable error messages (empty if valid).
 */
function validateJobInput({ operation, outputFormat, options }) {
  const errors = [];

  if (!OPERATIONS.includes(operation)) {
    errors.push(`operation must be one of: ${OPERATIONS.join(', ')}`);
  }
  if (!SUPPORTED_FORMATS.includes(outputFormat)) {
    errors.push(`outputFormat must be one of: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  switch (operation) {
    case 'resize': {
      const { width, height } = options || {};
      if (!width && !height) {
        errors.push('resize requires at least one of width or height');
      }
      if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
        errors.push('width must be a positive number');
      }
      if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
        errors.push('height must be a positive number');
      }
      break;
    }

    case 'compress': {
      const { crf, preset } = options || {};
      if (crf !== undefined && (!Number.isFinite(crf) || crf < 0 || crf > 51)) {
        errors.push('crf must be a number between 0 and 51');
      }
      const validPresets = ['ultrafast', 'fast', 'medium', 'slow'];
      if (preset !== undefined && !validPresets.includes(preset)) {
        errors.push(`preset must be one of: ${validPresets.join(', ')}`);
      }
      break;
    }

    case 'trim': {
      const { startTime, duration } = options || {};
      if (startTime === undefined || !Number.isFinite(startTime) || startTime < 0) {
        errors.push('startTime must be a non-negative number');
      }
      if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        errors.push('duration must be a positive number');
      }
      break;
    }

    case 'convert':
      // No extra options required.
      break;

    default:
      break;
  }

  return errors;
}

module.exports = { validateJobInput };
