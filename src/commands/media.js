const path = require('node:path');

const { createArtifactPath, loadManifest } = require('../lib/store');
const { extractClip, extractFrame } = require('../lib/media');

function formatSecondsForFile(value) {
  return value.toFixed(3).replace('.', '_');
}

async function runFrame(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const atSec = parseNumberFlag(flags, 'at', Number.NaN);
  if (!Number.isFinite(atSec)) {
    throw new Error('Missing required numeric flag: --at');
  }

  const manifest = loadManifest(id);
  const outputFlag = flags.output ?? flags.out;
  const output = outputFlag
    ? path.resolve(String(outputFlag))
    : createArtifactPath(id, 'frames', `frame-${formatSecondsForFile(atSec)}.jpg`);

  extractFrame(manifest.sourcePath, atSec, output);
  printJson({
    id,
    atSec,
    output,
  });
}

async function runClip(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const atSec = parseNumberFlag(flags, 'at', Number.NaN);
  const hasPre = Object.prototype.hasOwnProperty.call(flags, 'pre');
  const hasPost = Object.prototype.hasOwnProperty.call(flags, 'post');
  const hasDuration = Object.prototype.hasOwnProperty.call(flags, 'duration');
  let preSec = parseNumberFlag(flags, 'pre', 5);
  let postSec = parseNumberFlag(flags, 'post', 5);

  if (hasDuration && !hasPre && !hasPost) {
    const durationSec = parseNumberFlag(flags, 'duration', Number.NaN);
    if (durationSec <= 0) {
      throw new Error('Invalid numeric value for --duration');
    }
    preSec = durationSec / 2;
    postSec = durationSec / 2;
  }

  if (!Number.isFinite(atSec)) {
    throw new Error('Missing required numeric flag: --at');
  }

  const manifest = loadManifest(id);
  const outputFlag = flags.output ?? flags.out;
  const output = outputFlag
    ? path.resolve(String(outputFlag))
    : createArtifactPath(id, 'clips', `clip-${formatSecondsForFile(atSec)}.mp4`);

  extractClip(manifest, atSec, preSec, postSec, output);
  printJson({
    id,
    atSec,
    preSec,
    postSec,
    output,
  });
}

module.exports = { runFrame, runClip };
