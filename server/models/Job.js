const mongoose = require('mongoose');

// VIDEO_FORMATS are valid both as an upload's source format and as a normal
// export's output format. GIF is export-only (never a valid upload) but
// otherwise travels through the same resize/trim pipeline as video, so it's
// kept as its own constant rather than folded into VIDEO_FORMATS.
const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];
const GIF_FORMAT = 'gif';
const AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac'];
const IMAGE_FORMATS = ['jpg', 'png']; // thumbnail/spritesheet outputs only
const SUPPORTED_FORMATS = [...VIDEO_FORMATS, GIF_FORMAT, ...AUDIO_FORMATS, ...IMAGE_FORMATS];

const KINDS = ['export', 'thumbnail', 'spritesheet'];
const STATUSES = ['pending', 'processing', 'done', 'failed', 'cancelled'];

const jobSchema = new mongoose.Schema(
  {
    originalFilename: { type: String, required: true },
    storedFilename: { type: String, required: true },
    inputFormat: { type: String, enum: VIDEO_FORMATS, required: true },
    outputFormat: { type: String, enum: SUPPORTED_FORMATS, required: true },

    // 'export' (default) is the normal resize/quality/trim/convert pipeline.
    // 'thumbnail' and 'spritesheet' are a different kind of output entirely
    // (a still image, not a processed video/audio file) with their own,
    // much smaller options shape — see validateJobInput.js.
    kind: { type: String, enum: KINDS, default: 'export' },

    // A job is a single unified export, not one operation picked from a
    // list — any combination of resize/quality/trim can apply in one pass.
    // Shape depends on `kind`:
    //   export:
    //     resize: { width, height, preserveAspectRatio } | null
    //     quality: 0-100 (CRF for video, bitrate for audio-only)
    //     trim: { startTime, duration } | null
    //     audioOnly: boolean — strips video, outputFormat must be an audio format
    //   thumbnail:
    //     timestamp: seconds (defaults to the middle of the source if omitted)
    //   spritesheet:
    //     frameCount: number of frames to sample (default 16)
    //     columns: grid columns (default 4; rows are computed from frameCount)
    options: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: { type: String, enum: STATUSES, default: 'pending' },
    progress: { type: Number, default: 0 }, // 0-100

    inputPath: { type: String, required: true },
    outputPath: { type: String, default: null },
    errorMessage: { type: String, default: null },
    completedAt: { type: Date, default: null },

    // Set true by the cleanup job once the processed output file has been
    // deleted from disk. The Job record itself is kept for history.
    expired: { type: Boolean, default: false },

    // Per-job retention override (hours). Falls back to CLEANUP_MAX_AGE_HOURS
    // when null. deleteOnDownload triggers immediate cleanup after first
    // successful download rather than waiting for the sweep.
    retentionHours: { type: Number, default: null },
    deleteOnDownload: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Job', jobSchema);
module.exports.VIDEO_FORMATS = VIDEO_FORMATS;
module.exports.GIF_FORMAT = GIF_FORMAT;
module.exports.AUDIO_FORMATS = AUDIO_FORMATS;
module.exports.IMAGE_FORMATS = IMAGE_FORMATS;
module.exports.SUPPORTED_FORMATS = SUPPORTED_FORMATS;
module.exports.KINDS = KINDS;
