require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const jobRoutes = require('./routes/jobRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const { runCleanup } = require('./services/cleanupService');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/framefusion';

// Ensure upload/processed directories exist
['uploads', 'processed'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

app.use(cors());
app.use(express.json());

app.use('/api/jobs', jobRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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
    app.listen(PORT, () => console.log(`FrameFusion server running on port ${PORT}`));

    // Run once on boot, then hourly — deletes files older than
    // CLEANUP_MAX_AGE_HOURS and marks their Jobs as expired.
    runCleanup().catch((err) => console.error('[cleanup] initial run failed:', err.message));
    cron.schedule('0 * * * *', () => {
      runCleanup().catch((err) => console.error('[cleanup] scheduled run failed:', err.message));
    });
    console.log(`[cleanup] scheduled hourly, max age ${CLEANUP_MAX_AGE_HOURS}h`);
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
