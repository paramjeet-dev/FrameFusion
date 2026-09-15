const express = require('express');
const cors = require('cors');
const multer = require('multer');

const jobRoutes = require('./routes/jobRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const { VIDEO_FORMATS, AUDIO_FORMATS, IMAGE_FORMATS } = require('./models/Job');
const logger = require('./services/logger');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Structured per-request log line — method/path/status/duration as fields,
  // not a free-text string, so it's actually queryable in a log aggregator.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'http_request'
      );
    });
    next();
  });

  app.use('/api/jobs', jobRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Lets the frontend validate against real server limits instead of
  // hardcoding a second copy of them that can drift out of sync.
  app.get('/api/config', (req, res) => {
    res.json({
      maxFileSizeMB: Number(process.env.MAX_FILE_SIZE_MB || 500),
      videoFormats: VIDEO_FORMATS,
      audioFormats: AUDIO_FORMATS,
      imageFormats: IMAGE_FORMATS,
      defaultRetentionHours: Number(process.env.CLEANUP_MAX_AGE_HOURS || 24),
    });
  });

  // Error handler — gives specific messages for the most common failure modes
  // (oversized upload, unsupported format) instead of a generic 400/500.
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `File exceeds the ${process.env.MAX_FILE_SIZE_MB || 500}MB limit`,
      };
      return res.status(400).json({ error: messages[err.code] || err.message });
    }
    logger.error({ err: err.message, path: req.originalUrl }, 'unhandled_route_error');
    res.status(400).json({ error: err.message });
  });

  return app;
}

module.exports = createApp;
