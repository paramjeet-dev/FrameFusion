jest.mock('../services/jobCreationService', () => {
  class JobCreationError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return {
    createAndEnqueueJob: jest.fn(),
    JobCreationError,
  };
});

const request = require('supertest');
const createApp = require('../app');
const { createAndEnqueueJob, JobCreationError } = require('../services/jobCreationService');

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/config', () => {
  it('returns format lists and limits the frontend depends on', async () => {
    const app = createApp();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.videoFormats).toEqual(expect.arrayContaining(['mp4', 'webm']));
    expect(res.body.audioFormats).toEqual(expect.arrayContaining(['mp3']));
    expect(res.body.imageFormats).toEqual(expect.arrayContaining(['jpg']));
    expect(typeof res.body.maxFileSizeMB).toBe('number');
  });
});

describe('POST /api/jobs', () => {
  it('returns 201 with the jobId on success', async () => {
    createAndEnqueueJob.mockResolvedValue({ _id: 'job123', status: 'pending' });
    const app = createApp();

    const res = await request(app).post('/api/jobs').send({ uploadId: 'clip.mp4', outputFormat: 'mp4' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ jobId: 'job123', status: 'pending' });
  });

  it('maps a JobCreationError to its own status and message', async () => {
    createAndEnqueueJob.mockRejectedValue(new JobCreationError('outputFormat must be one of: mp4, mov', 400));
    const app = createApp();

    const res = await request(app).post('/api/jobs').send({ uploadId: 'clip.mp4', outputFormat: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outputFormat/);
  });

  it('falls back to 500 for an unexpected error', async () => {
    createAndEnqueueJob.mockRejectedValue(new Error('database is on fire'));
    const app = createApp();

    const res = await request(app).post('/api/jobs').send({ uploadId: 'clip.mp4', outputFormat: 'mp4' });

    expect(res.status).toBe(500);
  });
});
