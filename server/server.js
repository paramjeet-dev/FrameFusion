require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const createApp = require('./app');
const { runCleanup } = require('./services/cleanupService');
const jobEvents = require('./services/jobEvents');
const logger = require('./services/logger');
// The worker is no longer required here — it runs as its own process now
// (see worker.js at the project root). This process only talks to it via
// Redis: BullMQ for enqueueing jobs, and jobEvents/cancelChannel pub/sub for
// status updates and cancellation.

const app = createApp();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/framefusion';
const CLEANUP_MAX_AGE_HOURS = Number(process.env.CLEANUP_MAX_AGE_HOURS || 24);

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
  logger.info({ socketId: socket.id }, 'socket_connected');
  socket.on('disconnect', () => logger.info({ socketId: socket.id }, 'socket_disconnected'));
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    logger.info('MongoDB connected');
    httpServer.listen(PORT, () => logger.info({ port: PORT }, 'FrameFusion API + WebSocket listening'));

    // Run once on boot, then hourly — deletes files older than
    // CLEANUP_MAX_AGE_HOURS (or a job's own retentionHours override) and
    // marks their Jobs as expired.
    runCleanup().catch((err) => logger.error({ err: err.message }, 'initial_cleanup_failed'));
    cron.schedule('0 * * * *', () => {
      runCleanup().catch((err) => logger.error({ err: err.message }, 'scheduled_cleanup_failed'));
    });
    logger.info({ maxAgeHours: CLEANUP_MAX_AGE_HOURS }, 'cleanup_scheduled_hourly');
  })
  .catch((err) => {
    logger.fatal({ err: err.message }, 'mongodb_connection_failed');
    process.exit(1);
  });
