const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  createJob,
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

router.post('/', createJobLimiter, createJob);
router.get('/', listJobs);
router.get('/:id', getJobStatus);
router.get('/:id/download', downloadJob);
router.post('/:id/cancel', cancelJob);
router.delete('/:id', deleteJob);

module.exports = router;
