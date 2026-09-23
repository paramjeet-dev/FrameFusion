const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const PROCESSED_DIR = process.env.PROCESSED_DIR || 'processed';

function outputPathFor(outputFormat) {
  const filename = `${uuidv4()}.${outputFormat}`;
  return path.join(__dirname, '..', PROCESSED_DIR, filename);
}

/**
 * Maps the frontend's 0-100 "quality" slider to a codec-appropriate CRF.
 * The two codecs use different scales (x264: 0 best–51 worst, usable range
 * roughly 18-40; VP9: 0 best–63 worst, usable range roughly 15-35), so the
 * mapping isn't identical between them.
 */
function qualityToCrf(quality, codec) {
  const q = Math.min(100, Math.max(0, quality));
  if (codec === 'vp9') {
    return Math.round(15 + (1 - q / 100) * 20); // 100 -> 15 (best), 0 -> 35
  }
  return Math.round(18 + (1 - q / 100) * 22); // 100 -> 18 (best), 0 -> 40
}

/**
 * Maps the frontend's 0-100 "quality" slider to an audio bitrate (kbps)
 * for audio-only exports. 100 -> 320kbps, 0 -> 64kbps.
 */
function qualityToAudioBitrateKbps(quality) {
  const q = Math.min(100, Math.max(0, quality));
  return Math.round(64 + (q / 100) * 256);
}

/**
 * Maps quality to a GIF sample rate (fps). GIFs get huge fast, so this
 * stays much lower than a normal video framerate regardless of quality —
 * 100 -> 15fps (smooth-ish), 0 -> 5fps (choppy but tiny).
 */
function qualityToGifFps(quality) {
  const q = Math.min(100, Math.max(0, quality));
  return Math.round(5 + (q / 100) * 10);
}

/**
 * Runs an ffmpeg command and reports progress via the onProgress callback (0-100).
 */
function runCommand(command, onProgress) {
  return new Promise((resolve, reject) => {
    command
      .on('progress', (progress) => {
        if (onProgress && typeof progress.percent === 'number') {
          onProgress(Math.min(100, Math.max(0, Math.round(progress.percent))));
        }
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function buildScaleFilter(resize) {
  const { width, height, preserveAspectRatio = true } = resize;
  if (!preserveAspectRatio && width && height) {
    return `scale=${width}:${height}`; // exact, may distort
  }
  if (width && height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease`; // fit within box
  }
  if (width) return `scale=${width}:-2`;
  return `scale=-2:${height}`;
}

/**
 * A job is a single unified export — resize, quality, and trim are each
 * independently optional and combined into one ffmpeg command.
 *
 * options:
 *   resize: { width, height, preserveAspectRatio } | null/undefined
 *   quality: 0-100 (default 100) — CRF for video, bitrate for audio-only, or sample fps for gif
 *   trim: { startTime, duration } | null/undefined
 *   audioOnly: boolean — strips video entirely; outputFormat must be an audio format
 */
async function processVideo({ inputPath, outputFormat, options = {}, onProgress, registerCommand }) {
  const { resize, quality = 100, trim, audioOnly } = options;
  const outPath = outputPathFor(outputFormat);
  const command = ffmpeg(inputPath).output(outPath);

  if (trim) {
    const { startTime, duration } = trim;
    command.setStartTime(startTime).setDuration(duration);
  }

  if (audioOnly) {
    const bitrate = qualityToAudioBitrateKbps(quality);
    command.noVideo();

    const audioCodecs = { mp3: 'libmp3lame', aac: 'aac', wav: 'pcm_s16le', flac: 'flac' };
    command.audioCodec(audioCodecs[outputFormat] || 'aac');

    if (outputFormat === 'mp3' || outputFormat === 'aac') {
      command.audioBitrate(bitrate);
    }
  } else if (outputFormat === 'gif') {
    // GIFs need a generated palette to look decent (ffmpeg's default GIF
    // encoder without one looks noticeably banded) — the standard
    // palettegen/paletteuse trick, built as one filter_complex graph since
    // it needs to split the stream in two.
    const fps = qualityToGifFps(quality);
    const scale = resize ? buildScaleFilter(resize) : 'scale=480:-2:flags=lanczos'; // cap default size
    const filter = `fps=${fps},${scale},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`;
    command.noAudio().outputOptions(['-filter_complex', filter]);
  } else {
    if (resize) {
      command.videoFilters(buildScaleFilter(resize));
    }

    // Codec choice depends on the output container — libx264 doesn't mux into
    // webm, and VP9's default encoder settings are notoriously slow without
    // explicit speed flags.
    if (outputFormat === 'webm') {
      const crf = qualityToCrf(quality, 'vp9');
      command
        .videoCodec('libvpx-vp9')
        .audioCodec('libopus')
        .outputOptions([`-crf ${crf}`, '-b:v 0', '-deadline good', '-cpu-used 4', '-row-mt 1']);
    } else {
      const crf = qualityToCrf(quality, 'x264');
      command
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([`-crf ${crf}`, '-preset medium', '-pix_fmt yuv420p']);
    }
  }

  // Hand the command back to the caller (before .run()) so it can be killed
  // mid-flight for cancellation — runCommand() below is what calls .run().
  if (registerCommand) registerCommand(command);

  await runCommand(command, onProgress);
  return outPath;
}

/**
 * Extracts a single still frame as a JPG. Defaults to the midpoint of the
 * source if no timestamp is given — a reasonable "poster image" default.
 */
async function generateThumbnail({ inputPath, timestamp, registerCommand, onProgress }) {
  let ts = timestamp;
  if (ts === undefined || ts === null) {
    const meta = await getMetadata(inputPath);
    ts = (meta.durationSeconds || 2) / 2;
  }

  const outPath = outputPathFor('jpg');
  const command = ffmpeg(inputPath)
    .seekInput(ts)
    .outputOptions(['-frames:v 1', '-q:v 1']) // 1 = best JPEG quality (scale is 1-31, lower is better)
    .output(outPath);

  if (registerCommand) registerCommand(command);
  await runCommand(command, onProgress);
  return outPath;
}

/**
 * Samples `frameCount` frames evenly across the whole video and tiles them
 * into a single grid image — the kind of strip used for scrubbing previews
 * on a seek bar. Sampling rate is derived from frameCount/duration so the
 * frames land evenly spaced regardless of the source's actual framerate.
 */
async function generateSpriteSheet({
  inputPath,
  frameCount = 16,
  columns = 4,
  cellWidth = 320,
  registerCommand,
  onProgress,
}) {
  const meta = await getMetadata(inputPath);
  const duration = meta.durationSeconds || 1;
  const rows = Math.ceil(frameCount / columns);
  const fps = frameCount / duration;

  const outPath = outputPathFor('jpg');
  // scale first (never upscale past the source width), then tile. The
  // earlier version left quality at ffmpeg's mediocre image2 default and
  // capped cells at 160px — both made the sheet look soft/blocky regardless
  // of source resolution.
  const filter = `fps=${fps.toFixed(4)},scale='min(${cellWidth},iw)':-1:flags=lanczos,tile=${columns}x${rows}`;
  const command = ffmpeg(inputPath)
    .outputOptions(['-vf', filter, '-frames:v 1', '-q:v 2'])
    .output(outPath);

  if (registerCommand) registerCommand(command);
  await runCommand(command, onProgress);
  return outPath;
}

/**
 * Probes a video file and returns basic metadata used by the frontend
 * (duration for trim bounds, resolution for resize/aspect-ratio hints).
 */
function getMetadata(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);

      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      resolve({
        durationSeconds: Number(data.format?.duration) || 0,
        sizeBytes: Number(data.format?.size) || 0,
        width: videoStream?.width || null,
        height: videoStream?.height || null,
        codec: videoStream?.codec_name || null,
      });
    });
  });
}

module.exports = {
  processVideo,
  generateThumbnail,
  generateSpriteSheet,
  getMetadata,
  qualityToCrf,
  qualityToAudioBitrateKbps,
  qualityToGifFps,
};
