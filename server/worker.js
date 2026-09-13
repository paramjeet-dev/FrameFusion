require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/framefusion';

// The worker reads/writes the same uploads/processed directories as the API
// process. This assumes both run on the same machine with shared disk — if
// that ever changes (e.g. deploying the worker on a separate host), these
// would need to move to shared storage (S3 or similar) instead of local disk.
['uploads', 'uploads/chunks', 'processed'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('[worker] MongoDB connected');
    require('./services/worker'); // starts the BullMQ worker
    console.log('[worker] listening for video-processing jobs');
  })
  .catch((err) => {
    console.error('[worker] MongoDB connection error:', err.message);
    process.exit(1);
  });
