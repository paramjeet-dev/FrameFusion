const { VIDEO_FORMATS, GIF_FORMAT, AUDIO_FORMATS, IMAGE_FORMATS } = require('../models/Job');

/**
 * Returns an array of human-readable error messages (empty if valid).
 *
 * `kind` changes what's valid entirely:
 *  - 'export' (default): the normal resize/quality/trim/convert pipeline.
 *    `resize` and `trim` are optional; `quality` defaults to 100;
 *    `audioOnly` switches the valid outputFormat set to audio formats and
 *    makes `resize` meaningless.
 *  - 'thumbnail' / 'spritesheet': a still-image output. resize/quality/trim/
 *    audioOnly don't apply at all — these have their own, much smaller
 *    options shape (see models/Job.js).
 */
function validateJobInput({ outputFormat, options = {}, kind = 'export' }) {
  if (kind === 'thumbnail' || kind === 'spritesheet') {
    return validateImageJob({ outputFormat, options, kind });
  }
  return validateExportJob({ outputFormat, options });
}

function validateImageJob({ outputFormat, options, kind }) {
  const errors = [];

  if (!IMAGE_FORMATS.includes(outputFormat)) {
    errors.push(`outputFormat must be one of: ${IMAGE_FORMATS.join(', ')} for ${kind}`);
  }

  if (kind === 'thumbnail') {
    const { timestamp } = options;
    if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
      errors.push('timestamp must be a non-negative number of seconds');
    }
  }

  if (kind === 'spritesheet') {
    const { frameCount, columns, cellWidth } = options;
    if (frameCount !== undefined && (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 64)) {
      errors.push('frameCount must be an integer between 1 and 64');
    }
    if (columns !== undefined && (!Number.isInteger(columns) || columns < 1 || columns > 16)) {
      errors.push('columns must be an integer between 1 and 16');
    }
    if (cellWidth !== undefined && (!Number.isInteger(cellWidth) || cellWidth < 80 || cellWidth > 3840)) {
      errors.push('cellWidth must be an integer between 80 and 3840');
    }
  }

  return errors;
}

function validateExportJob({ outputFormat, options }) {
  const errors = [];
  const { resize, quality, trim, audioOnly } = options;

  const validFormats = audioOnly ? AUDIO_FORMATS : [...VIDEO_FORMATS, GIF_FORMAT];
  if (!validFormats.includes(outputFormat)) {
    errors.push(
      audioOnly
        ? `outputFormat must be one of: ${AUDIO_FORMATS.join(', ')} when audioOnly is set`
        : `outputFormat must be one of: ${VIDEO_FORMATS.join(', ')}, ${GIF_FORMAT}`
    );
  }

  if (resize && audioOnly) {
    errors.push('resize cannot be combined with audioOnly (there is no video stream to resize)');
  } else if (resize) {
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
