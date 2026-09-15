jest.mock('../models/Job', () => ({
  VIDEO_FORMATS: ['mp4', 'mov', 'avi', 'flv', 'm4v', 'webm'],
  GIF_FORMAT: 'gif',
  AUDIO_FORMATS: ['mp3', 'aac', 'wav', 'flac'],
  IMAGE_FORMATS: ['jpg', 'png'],
  create: jest.fn(),
}));

jest.mock('../services/queue', () => ({
  videoQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('fs/promises', () => ({
  access: jest.fn(),
}));

const fs = require('fs/promises');
const Job = require('../models/Job');
const { videoQueue } = require('../services/queue');
const { createAndEnqueueJob, JobCreationError } = require('../services/jobCreationService');

describe('createAndEnqueueJob', () => {
  it('rejects when uploadId is missing', async () => {
    await expect(createAndEnqueueJob({ outputFormat: 'mp4' })).rejects.toBeInstanceOf(JobCreationError);
  });

  it('rejects when the referenced upload does not exist on disk', async () => {
    fs.access.mockRejectedValue(new Error('ENOENT'));
    await expect(
      createAndEnqueueJob({ uploadId: 'missing-file.mp4', outputFormat: 'mp4' })
    ).rejects.toThrow(/Upload not found/);
  });

  it('rejects an invalid outputFormat before touching the database', async () => {
    fs.access.mockResolvedValue(undefined);
    await expect(
      createAndEnqueueJob({ uploadId: 'clip.mp4', outputFormat: 'exe' })
    ).rejects.toThrow(/outputFormat/);
    expect(Job.create).not.toHaveBeenCalled();
  });

  it('rejects a non-positive retentionHours', async () => {
    fs.access.mockResolvedValue(undefined);
    await expect(
      createAndEnqueueJob({ uploadId: 'clip.mp4', outputFormat: 'mp4', retentionHours: -5 })
    ).rejects.toThrow(/retentionHours/);
  });

  it('creates and enqueues a valid export job', async () => {
    fs.access.mockResolvedValue(undefined);
    Job.create.mockResolvedValue({ _id: 'job1', status: 'pending' });

    const job = await createAndEnqueueJob({
      uploadId: 'clip.mp4',
      originalFilename: 'clip.mp4',
      outputFormat: 'mp4',
      options: { quality: 80 },
    });

    expect(job.status).toBe('pending');
    expect(Job.create).toHaveBeenCalledTimes(1);
    expect(Job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outputFormat: 'mp4',
        kind: 'export',
        inputFormat: 'mp4',
        deleteOnDownload: true,
      })
    );
    expect(videoQueue.add).toHaveBeenCalledWith(
      'process-video',
      expect.objectContaining({ jobId: 'job1' }),
      expect.objectContaining({ jobId: 'job1' })
    );
  });

  it('creates a thumbnail job with kind passed through', async () => {
    fs.access.mockResolvedValue(undefined);
    Job.create.mockResolvedValue({ _id: 'job2', status: 'pending' });

    await createAndEnqueueJob({
      uploadId: 'clip.mp4',
      outputFormat: 'jpg',
      kind: 'thumbnail',
      options: { timestamp: 3 },
    });

    expect(Job.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'thumbnail', outputFormat: 'jpg' }));
  });

  it('respects an explicit deleteOnDownload: false', async () => {
    fs.access.mockResolvedValue(undefined);
    Job.create.mockResolvedValue({ _id: 'job3', status: 'pending' });

    await createAndEnqueueJob({
      uploadId: 'clip.mp4',
      outputFormat: 'mp4',
      deleteOnDownload: false,
    });

    expect(Job.create).toHaveBeenCalledWith(expect.objectContaining({ deleteOnDownload: false }));
  });

  it('strips any directory traversal attempt from uploadId', async () => {
    fs.access.mockResolvedValue(undefined);
    Job.create.mockResolvedValue({ _id: 'job4', status: 'pending' });

    await createAndEnqueueJob({
      uploadId: '../../etc/passwd',
      outputFormat: 'mp4',
    });

    const [[createArgs]] = Job.create.mock.calls;
    expect(createArgs.storedFilename).toBe('passwd');
    expect(createArgs.inputPath).not.toMatch(/\.\./);
  });
});
