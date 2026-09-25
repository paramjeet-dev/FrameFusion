const { validateJobInput } = require('../utils/validateJobInput');

describe('validateJobInput - export jobs', () => {
  it('accepts a plain convert with no resize/trim', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: { quality: 100 } });
    expect(errors).toEqual([]);
  });

  it('rejects an unsupported output format', () => {
    const errors = validateJobInput({ outputFormat: 'exe', options: {} });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/outputFormat/);
  });

  it('accepts gif as an export-only video format', () => {
    const errors = validateJobInput({ outputFormat: 'gif', options: { quality: 80 } });
    expect(errors).toEqual([]);
  });

  it('requires at least one of width/height for resize', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: { resize: {} } });
    expect(errors).toContain('resize requires at least one of width or height');
  });

  it('rejects a non-positive resize width', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: { resize: { width: -10 } } });
    expect(errors.some((e) => e.includes('width'))).toBe(true);
  });

  it('rejects quality outside 0-100', () => {
    expect(validateJobInput({ outputFormat: 'mp4', options: { quality: 150 } })).toEqual(
      expect.arrayContaining([expect.stringContaining('quality')])
    );
    expect(validateJobInput({ outputFormat: 'mp4', options: { quality: -1 } })).toEqual(
      expect.arrayContaining([expect.stringContaining('quality')])
    );
  });

  it('requires both startTime and duration for trim', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: { trim: { startTime: 5 } } });
    expect(errors.some((e) => e.includes('duration'))).toBe(true);
  });

  it('rejects a negative trim startTime', () => {
    const errors = validateJobInput({
      outputFormat: 'mp4',
      options: { trim: { startTime: -1, duration: 5 } },
    });
    expect(errors.some((e) => e.includes('startTime'))).toBe(true);
  });

  it('accepts audio formats when audioOnly is set', () => {
    const errors = validateJobInput({ outputFormat: 'mp3', options: { audioOnly: true, quality: 80 } });
    expect(errors).toEqual([]);
  });

  it('rejects a video format when audioOnly is set', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: { audioOnly: true } });
    expect(errors.some((e) => e.includes('outputFormat'))).toBe(true);
  });

  it('rejects resize combined with audioOnly', () => {
    const errors = validateJobInput({
      outputFormat: 'mp3',
      options: { audioOnly: true, resize: { width: 640 } },
    });
    expect(errors.some((e) => e.includes('audioOnly'))).toBe(true);
  });
});

describe('validateJobInput - thumbnail jobs', () => {
  it('accepts a thumbnail with no timestamp (defaults server-side)', () => {
    const errors = validateJobInput({ outputFormat: 'jpg', options: {}, kind: 'thumbnail' });
    expect(errors).toEqual([]);
  });

  it('rejects a non-image outputFormat for a thumbnail', () => {
    const errors = validateJobInput({ outputFormat: 'mp4', options: {}, kind: 'thumbnail' });
    expect(errors.some((e) => e.includes('outputFormat'))).toBe(true);
  });

  it('rejects a negative timestamp', () => {
    const errors = validateJobInput({ outputFormat: 'jpg', options: { timestamp: -5 }, kind: 'thumbnail' });
    expect(errors.some((e) => e.includes('timestamp'))).toBe(true);
  });

  it('ignores export-only fields like resize/trim for a thumbnail', () => {
    const errors = validateJobInput({
      outputFormat: 'jpg',
      options: { resize: { width: -1 }, trim: {} },
      kind: 'thumbnail',
    });
    expect(errors).toEqual([]);
  });
});

describe('validateJobInput - spritesheet jobs', () => {
  it('accepts default frameCount/columns', () => {
    const errors = validateJobInput({ outputFormat: 'jpg', options: {}, kind: 'spritesheet' });
    expect(errors).toEqual([]);
  });

  it('rejects a frameCount outside 1-64', () => {
    expect(
      validateJobInput({ outputFormat: 'jpg', options: { frameCount: 0 }, kind: 'spritesheet' })
    ).toEqual(expect.arrayContaining([expect.stringContaining('frameCount')]));
    expect(
      validateJobInput({ outputFormat: 'jpg', options: { frameCount: 100 }, kind: 'spritesheet' })
    ).toEqual(expect.arrayContaining([expect.stringContaining('frameCount')]));
  });

  it('rejects non-integer columns', () => {
    const errors = validateJobInput({ outputFormat: 'jpg', options: { columns: 2.5 }, kind: 'spritesheet' });
    expect(errors.some((e) => e.includes('columns'))).toBe(true);
  });

  it('rejects a cellWidth outside 80-3840', () => {
    expect(
      validateJobInput({ outputFormat: 'jpg', options: { cellWidth: 40 }, kind: 'spritesheet' })
    ).toEqual(expect.arrayContaining([expect.stringContaining('cellWidth')]));
    expect(
      validateJobInput({ outputFormat: 'jpg', options: { cellWidth: 5000 }, kind: 'spritesheet' })
    ).toEqual(expect.arrayContaining([expect.stringContaining('cellWidth')]));
  });

  it('accepts a valid cellWidth', () => {
    const errors = validateJobInput({ outputFormat: 'jpg', options: { cellWidth: 320 }, kind: 'spritesheet' });
    expect(errors).toEqual([]);
  });
});
