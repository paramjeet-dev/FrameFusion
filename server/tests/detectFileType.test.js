const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { detectContainer, verifyContainerMatchesExtension } = require('../utils/detectFileType');

const tmpDir = path.join(os.tmpdir(), 'framefusion-detect-tests');

async function writeFixture(name, bytes) {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, Buffer.from(bytes));
  return filePath;
}

describe('detectContainer', () => {
  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('recognizes an MP4-style ftyp box', async () => {
    const bytes = [0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from('isom')];
    const filePath = await writeFixture('fake.mp4', bytes);
    expect(await detectContainer(filePath)).toBe('mp4');
  });

  it('recognizes a MOV-style ftyp box (qt brand)', async () => {
    const bytes = [0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from('qt  ')];
    const filePath = await writeFixture('fake.mov', bytes);
    expect(await detectContainer(filePath)).toBe('mov');
  });

  it('recognizes an AVI RIFF header', async () => {
    const bytes = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('AVI ')];
    const filePath = await writeFixture('fake.avi', bytes);
    expect(await detectContainer(filePath)).toBe('avi');
  });

  it('recognizes an FLV signature', async () => {
    const bytes = [...Buffer.from('FLV'), 1, 0, 0, 0, 0, 9];
    const filePath = await writeFixture('fake.flv', bytes);
    expect(await detectContainer(filePath)).toBe('flv');
  });

  it('recognizes a WebM/EBML header', async () => {
    const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0];
    const filePath = await writeFixture('fake.webm', bytes);
    expect(await detectContainer(filePath)).toBe('webm');
  });

  it('returns null for content that matches no known signature', async () => {
    const filePath = await writeFixture('fake.txt', Buffer.from('this is definitely not a video'));
    expect(await detectContainer(filePath)).toBeNull();
  });
});

describe('verifyContainerMatchesExtension', () => {
  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts a real mp4 claiming to be .mp4', async () => {
    const bytes = [0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from('isom')];
    const filePath = await writeFixture('real.mp4', bytes);
    const result = await verifyContainerMatchesExtension(filePath, 'mp4');
    expect(result.ok).toBe(true);
  });

  it('accepts mp4-signature bytes claiming to be .m4v (same container family)', async () => {
    const bytes = [0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from('isom')];
    const filePath = await writeFixture('real.m4v', bytes);
    const result = await verifyContainerMatchesExtension(filePath, 'm4v');
    expect(result.ok).toBe(true);
  });

  it('rejects a renamed non-video file claiming to be .mp4', async () => {
    const filePath = await writeFixture('fake-renamed.mp4', Buffer.from('MZ\x90\x00'));
    const result = await verifyContainerMatchesExtension(filePath, 'mp4');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not look like a valid video/);
  });

  it('rejects a webm file renamed to .mp4', async () => {
    const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0];
    const filePath = await writeFixture('mismatched.mp4', bytes);
    const result = await verifyContainerMatchesExtension(filePath, 'mp4');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/webm/);
  });
});
