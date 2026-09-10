const fs = require('fs/promises');
const { getMetadata } = require('../services/ffmpegService');

// POST /api/uploads
// multipart/form-data: file
// Saves the file to the uploads dir (via the upload middleware) and probes
// it immediately. The file is kept on disk — job creation later references
// it by uploadId instead of re-uploading the bytes. Untouched staged
// uploads are swept up by the regular cleanup job like any other upload.
async function stageUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const metadata = await getMetadata(req.file.path);
    return res.status(201).json({
      uploadId: req.file.filename,
      originalFilename: req.file.originalname,
      ...metadata,
    });
  } catch (err) {
    // Unreadable/corrupt file — no point keeping it staged.
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: `Could not read video metadata: ${err.message}` });
  }
}

module.exports = { stageUpload };
