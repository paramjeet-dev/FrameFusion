const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const upload = require('../middleware/upload');
const { stageUpload } = require('../controllers/uploadController');

// Uploads move real bytes and disk space, so they're limited a bit tighter
// than plain reads: 30 uploads per 15 minutes per IP.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads from this address — please wait a bit before trying again.' },
});

router.post('/', uploadLimiter, upload.single('file'), stageUpload);

module.exports = router;
