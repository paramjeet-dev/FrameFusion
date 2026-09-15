const { serializeJob, summarizeTransforms } = require('../utils/serializeJob');

describe('summarizeTransforms', () => {
  it('returns "convert" when no optional transforms are set', () => {
    expect(summarizeTransforms({ quality: 100 })).toBe('convert');
  });

  it('lists each active transform', () => {
    expect(summarizeTransforms({ resize: { width: 640 }, quality: 100, trim: { startTime: 0, duration: 5 } })).toBe(
      'resize · trim'
    );
  });

  it('includes quality only when below 100', () => {
    expect(summarizeTransforms({ quality: 60 })).toBe('quality 60');
    expect(summarizeTransforms({ quality: 100 })).toBe('convert');
  });

  it('marks audioOnly first', () => {
    expect(summarizeTransforms({ audioOnly: true, trim: { startTime: 0, duration: 5 } })).toBe('audio only · trim');
  });

  it('returns "thumbnail" for thumbnail jobs regardless of options', () => {
    expect(summarizeTransforms({ resize: { width: 100 } }, 'thumbnail')).toBe('thumbnail');
  });

  it('returns "sprite sheet" for spritesheet jobs', () => {
    expect(summarizeTransforms({}, 'spritesheet')).toBe('sprite sheet');
  });
});

describe('serializeJob', () => {
  const baseJob = {
    _id: '507f1f77bcf86cd799439011',
    status: 'done',
    progress: 100,
    errorMessage: null,
    originalFilename: 'clip.mp4',
    kind: 'export',
    options: { quality: 100 },
    outputFormat: 'mp4',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expired: false,
    retentionHours: null,
    deleteOnDownload: true,
  };

  it('includes a downloadUrl for a done, non-expired job', () => {
    const result = serializeJob(baseJob);
    expect(result.downloadUrl).toBe(`/api/jobs/${baseJob._id}/download`);
    expect(result.jobId).toBe(baseJob._id);
  });

  it('omits the downloadUrl once expired', () => {
    const result = serializeJob({ ...baseJob, expired: true });
    expect(result.downloadUrl).toBeNull();
  });

  it('omits the downloadUrl while still processing', () => {
    const result = serializeJob({ ...baseJob, status: 'processing', progress: 40 });
    expect(result.downloadUrl).toBeNull();
    expect(result.progress).toBe(40);
  });
});
