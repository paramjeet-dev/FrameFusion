const mongoose = require('mongoose');

const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];
const AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac'];
const SUPPORTED_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS];
const STATUSES = ['pending', 'processing', 'done', 'failed', 'cancelled'];

const jobSchema = new mongoose.Schema(
  {
    originalFilename: { type: String, required: true },
    storedFilename: { type: String, required: true },
    inputFormat: { type: String, enum: VIDEO_FORMATS, required: true },
    outputFormat: { type: String, enum: SUPPORTED_FORMATS, required: true },

    // A job is a single unified export, not one operation picked from a
    // list — any combination of resize/quality/trim can apply in one pass.
    // Shape:
    //   {
    //     resize: { width, height, preserveAspectRatio } | null,
    //     quality: 0-100 (maps to CRF for video, or bitrate for audio-only),
    //     trim: { startTime, duration } | null,
    //     audioOnly: boolean — strips video, outputFormat must then be one
    //       of AUDIO_FORMATS and `resize` is ignored (meaningless for audio).
    //   }
    // `resize`/`trim` are null when that transform isn't requested at all
    // (i.e. keep original resolution / keep full length).
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
module.exports.AUDIO_FORMATS = AUDIO_FORMATS;
module.exports.SUPPORTED_FORMATS = SUPPORTED_FORMATS;

