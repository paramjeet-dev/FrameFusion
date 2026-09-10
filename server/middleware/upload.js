const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { SUPPORTED_FORMATS } = require('../models/Job');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 500);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', UPLOAD_DIR));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return cb(
      new Error(
        `Unsupported format ".${ext}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
      )
    );
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

module.exports = upload;
