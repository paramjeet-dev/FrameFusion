const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { stageUpload } = require('../controllers/uploadController');

router.post('/', upload.single('file'), stageUpload);

module.exports = router;
