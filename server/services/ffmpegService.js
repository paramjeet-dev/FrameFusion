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
 * operation: 'resize' | 'compress' | 'trim' | 'convert'
 * options depend on operation (see Job model comments)
 */
async function processVideo({ inputPath, operation, outputFormat, options = {}, onProgress }) {
  const outPath = outputPathFor(outputFormat);
  const command = ffmpeg(inputPath).output(outPath);

  switch (operation) {
    case 'resize': {
      const { width, height, preserveAspectRatio = true } = options;
      if (!width && !height) {
        throw new Error('resize requires at least one of width or height');
      }

      // -2 (rather than -1) keeps the computed dimension even, which libx264
      // requires for yuv420p output.
      let scaleFilter;
      if (!preserveAspectRatio && width && height) {
        // Exact dimensions, may distort the image.
        scaleFilter = `scale=${width}:${height}`;
      } else if (width && height) {
        // Fit within the given box, preserving aspect ratio (no cropping/padding).
        scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
      } else if (width) {
        scaleFilter = `scale=${width}:-2`;
      } else {
        scaleFilter = `scale=-2:${height}`;
      }
      command.videoFilters(scaleFilter);
      break;
    }

    case 'compress': {
      // CRF: lower = higher quality/larger file. 23 is a sane default.
      const crf = options.crf ?? 28;
      const preset = options.preset || 'medium';
      command.videoCodec('libx264').outputOptions([`-crf ${crf}`, `-preset ${preset}`]);
      break;
    }

    case 'trim': {
      const { startTime, duration } = options;
      if (startTime === undefined || duration === undefined) {
        throw new Error('trim requires startTime and duration (in seconds)');
      }
      command.setStartTime(startTime).setDuration(duration);
      break;
    }

    case 'convert': {
      // Just letting the output extension drive the container/codec choice.
      // fluent-ffmpeg infers codec from output extension in most cases.
      break;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

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

module.exports = { processVideo, getMetadata };
