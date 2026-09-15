const { qualityToCrf, qualityToAudioBitrateKbps, qualityToGifFps } = require('../services/ffmpegService');

describe('qualityToCrf', () => {
  it('maps 100 to the best (lowest) CRF for x264', () => {
    expect(qualityToCrf(100, 'x264')).toBe(18);
  });

  it('maps 0 to the worst (highest) CRF for x264', () => {
    expect(qualityToCrf(0, 'x264')).toBe(40);
  });

  it('maps 100 to the best CRF for vp9', () => {
    expect(qualityToCrf(100, 'vp9')).toBe(15);
  });

  it('maps 0 to the worst CRF for vp9', () => {
    expect(qualityToCrf(0, 'vp9')).toBe(35);
  });

  it('clamps out-of-range input rather than producing nonsense', () => {
    expect(qualityToCrf(150, 'x264')).toBe(qualityToCrf(100, 'x264'));
    expect(qualityToCrf(-50, 'x264')).toBe(qualityToCrf(0, 'x264'));
  });

  it('is monotonically decreasing as quality increases (lower CRF = better)', () => {
    const crf25 = qualityToCrf(25, 'x264');
    const crf75 = qualityToCrf(75, 'x264');
    expect(crf75).toBeLessThan(crf25);
  });
});

describe('qualityToAudioBitrateKbps', () => {
  it('maps 100 to 320kbps', () => {
    expect(qualityToAudioBitrateKbps(100)).toBe(320);
  });

  it('maps 0 to 64kbps', () => {
    expect(qualityToAudioBitrateKbps(0)).toBe(64);
  });

  it('is monotonically increasing with quality', () => {
    expect(qualityToAudioBitrateKbps(75)).toBeGreaterThan(qualityToAudioBitrateKbps(25));
  });
});

describe('qualityToGifFps', () => {
  it('maps 100 to 15fps and 0 to 5fps', () => {
    expect(qualityToGifFps(100)).toBe(15);
    expect(qualityToGifFps(0)).toBe(5);
  });

  it('clamps out-of-range input', () => {
    expect(qualityToGifFps(200)).toBe(qualityToGifFps(100));
    expect(qualityToGifFps(-10)).toBe(qualityToGifFps(0));
  });
});
