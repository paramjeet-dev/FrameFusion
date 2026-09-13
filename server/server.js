require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const jobRoutes = require('./routes/jobRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const { runCleanup } = require('./services/cleanupService');
const { VIDEO_FORMATS, AUDIO_FORMATS } = require('./models/Job');
const jobEvents = require('./services/jobEvents');
// The worker is no longer required here — it runs as its own process now
// (see worker.js at the project root). This process only talks to it via
// Redis: BullMQ for enqueueing jobs, and jobEvents/cancelChannel pub/sub for
// status updates and cancellation.

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/framefusion';

// Ensure upload/processed directories exist (including the chunk-upload staging area)
['uploads', 'uploads/chunks', 'processed'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Re-broadcast worker job events to all connected clients. Simple global
// broadcast rather than per-job rooms — job volume here doesn't warrant the
// extra bookkeeping, and clients just ignore updates for jobs they don't have.
jobEvents.subscribe((payload) => io.emit('job:update', payload));

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[socket] client disconnected: ${socket.id}`));
});

app.use(cors());
app.use(express.json());

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
    defaultRetentionHours: Number(process.env.CLEANUP_MAX_AGE_HOURS || 24),
  });
});

// Error handler — gives specific messages for the most common failure modes
// (oversized upload, unsupported format) instead of a generic 500/400.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `File exceeds the ${process.env.MAX_FILE_SIZE_MB || 500}MB limit`,
    };
    return res.status(400).json({ error: messages[err.code] || err.message });
  }
  console.error(err);
  res.status(400).json({ error: err.message });
});

const CLEANUP_MAX_AGE_HOURS = Number(process.env.CLEANUP_MAX_AGE_HOURS || 24);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    httpServer.listen(PORT, () =>
      console.log(`FrameFusion server (API + WebSocket) running on port ${PORT}`)
    );

    // Run once on boot, then hourly — deletes files older than
    // CLEANUP_MAX_AGE_HOURS (or a job's own retentionHours override) and
    // marks their Jobs as expired.
    runCleanup().catch((err) => console.error('[cleanup] initial run failed:', err.message));
    cron.schedule('0 * * * *', () => {
      runCleanup().catch((err) => console.error('[cleanup] scheduled run failed:', err.message));
    });
    console.log(`[cleanup] scheduled hourly, default max age ${CLEANUP_MAX_AGE_HOURS}h`);
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
