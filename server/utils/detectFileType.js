const fs = require('fs/promises');

/**
 * Reads the first bytes of a file and checks them against known container
 * signatures. This is intentionally narrow — just enough to catch "renamed
 * .exe to .mp4" style spoofing for the specific containers this app claims
 * to support — rather than a general-purpose file-type sniffer.
 */
async function detectContainer(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64);
    await fh.read(buffer, 0, 64, 0);

    // MP4 / MOV / M4V: an ISO base media file has an 'ftyp' box, with the
    // box type at byte offset 4 (after the 4-byte box size).
    if (buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (brand === 'qt  ') return 'mov';
      return 'mp4'; // covers mp4/m4v and other ISO-BMFF brands generically
    }

    // AVI: RIFF container with an 'AVI ' form type.
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'AVI ') {
      return 'avi';
    }

    // FLV: literal 'FLV' signature followed by a version byte.
    if (buffer.toString('ascii', 0, 3) === 'FLV') {
      return 'flv';
    }

    // WebM/Matroska: EBML header magic number.
    if (buffer.readUInt32BE(0) === 0x1a45dfa3) {
      return 'webm';
    }

    return null; // unrecognized — not necessarily malicious, just not one of ours
  } finally {
    await fh.close();
  }
}

// mp4/m4v/mov all share the same ISO-BMFF container signature at this level
// of inspection, so they can't be told apart from bytes alone — that's fine,
// this only needs to catch "this isn't a video at all" style mismatches.
const COMPATIBLE_WITH = {
  mp4: ['mp4', 'mov'],
  m4v: ['mp4', 'mov'],
  mov: ['mp4', 'mov'],
  avi: ['avi'],
  flv: ['flv'],
  webm: ['webm'],
};

/**
 * Returns { ok: true, detected } or { ok: false, reason }.
 */
async function verifyContainerMatchesExtension(filePath, claimedExt) {
  const detected = await detectContainer(filePath);
  if (!detected) {
    return {
      ok: false,
      reason: 'The file does not look like a valid video container — it may be corrupt or not actually a video',
    };
  }
  const allowed = COMPATIBLE_WITH[claimedExt] || [claimedExt];
  if (!allowed.includes(detected)) {
    return {
      ok: false,
      reason: `File contents look like .${detected}, not .${claimedExt} as the filename suggests`,
    };
  }
  return { ok: true, detected };
}

module.exports = { detectContainer, verifyContainerMatchesExtension };
