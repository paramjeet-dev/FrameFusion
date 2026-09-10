const express = require('express');
const router = express.Router();
const { createJob, getJobStatus, listJobs, downloadJob } = require('../controllers/jobController');

router.post('/', createJob);
router.get('/', listJobs);
router.get('/:id', getJobStatus);
router.get('/:id/download', downloadJob);

module.exports = router;

