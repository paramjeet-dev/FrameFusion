const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  createJob,
  createBatchJobs,
  getJobStatus,
  listJobs,
  downloadJob,
  cancelJob,
  deleteJob,
} = require('../controllers/jobController');

// Job creation kicks off real CPU work, so it gets a tighter limit than
// simple reads: 20 jobs per 15 minutes per IP.
const createJobLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many jobs started from this address — please wait a bit before trying again.' },
});

// Batch creates several jobs per request, so it gets its own (looser) limit
// rather than sharing the single-job one, which would make a single batch
// of 20 files eat the entire 15-minute window.
const batchJobLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many batch requests from this address — please wait a bit before trying again.' },
});

router.post('/batch', batchJobLimiter, createBatchJobs);
router.post('/', createJobLimiter, createJob);
router.get('/', listJobs);
router.get('/:id', getJobStatus);
router.get('/:id/download', downloadJob);
router.post('/:id/cancel', cancelJob);
router.delete('/:id', deleteJob);

module.exports = router;
