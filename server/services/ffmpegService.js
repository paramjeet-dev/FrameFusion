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

/**
 * Maps the frontend's 0-100 "quality" slider to an audio bitrate (kbps)
 * for audio-only exports. 100 -> 320kbps (effectively transparent for most
 * codecs here), 0 -> 64kbps (noticeably compressed but still intelligible).
 */
function qualityToAudioBitrateKbps(quality) {
  const q = Math.min(100, Math.max(0, quality));
  return Math.round(64 + (q / 100) * 256);
}

/**
 * A job is a single unified export — resize, quality, and trim are each
 * independently optional and combined into one ffmpeg command, rather than
 * picking exactly one transform to run.
 *
 * options:
 *   resize: { width, height, preserveAspectRatio } | null/undefined — no resize if omitted (ignored when audioOnly)
 *   quality: 0-100 (default 100) — CRF for video, or bitrate for audio-only
 *   trim: { startTime, duration } | null/undefined — no trim if omitted
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
    // No video stream at all — resize is meaningless here and is rejected
    // earlier in validation, but double-check rather than silently ignore.
    const bitrate = qualityToAudioBitrateKbps(quality);
    command.noVideo();

    const audioCodecs = { mp3: 'libmp3lame', aac: 'aac', wav: 'pcm_s16le', flac: 'flac' };
    command.audioCodec(audioCodecs[outputFormat] || 'aac');

    // Lossless formats (wav/flac) don't take a bitrate target — the quality
    // slider only has an effect on the lossy formats (mp3/aac).
    if (outputFormat === 'mp3' || outputFormat === 'aac') {
      command.audioBitrate(bitrate);
    }
  } else {
    if (resize) {
      const { width, height, preserveAspectRatio = true } = resize;
      // -2 (rather than -1) keeps the computed dimension even, which both
      // libx264 and libvpx-vp9 require for standard chroma subsampling.
      let scaleFilter;
      if (!preserveAspectRatio && width && height) {
        scaleFilter = `scale=${width}:${height}`; // exact, may distort
      } else if (width && height) {
        scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease`; // fit within box
      } else if (width) {
        scaleFilter = `scale=${width}:-2`;
      } else {
        scaleFilter = `scale=-2:${height}`;
      }
      command.videoFilters(scaleFilter);
    }

    // Codec choice depends on the output container — libx264 doesn't mux into
    // webm, and VP9's default encoder settings are notoriously slow without
    // explicit speed flags (a likely cause if a "convert to webm" job ever
    // felt stuck-slow rather than actually hung).
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

module.exports = { processVideo, getMetadata, qualityToCrf };
