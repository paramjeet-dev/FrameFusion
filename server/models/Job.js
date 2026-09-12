const mongoose = require('mongoose');

const SUPPORTED_FORMATS = ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'];
const STATUSES = ['pending', 'processing', 'done', 'failed', 'cancelled'];

const jobSchema = new mongoose.Schema(
  {
    originalFilename: { type: String, required: true },
    storedFilename: { type: String, required: true },
    inputFormat: { type: String, enum: SUPPORTED_FORMATS, required: true },
    outputFormat: { type: String, enum: SUPPORTED_FORMATS, required: true },

    // A job is a single unified export, not one operation picked from a
    // list — any combination of resize/quality/trim can apply in one pass.
    // Shape:
    //   {
    //     resize: { width, height, preserveAspectRatio } | null,
    //     quality: 0-100 (maps to CRF; 100 = best quality/least compression),
    //     trim: { startTime, duration } | null,
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
module.exports.SUPPORTED_FORMATS = SUPPORTED_FORMATS;
