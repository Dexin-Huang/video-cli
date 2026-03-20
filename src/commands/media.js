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
  const output = flags.output
    ? path.resolve(String(flags.output))
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
  const preSec = parseNumberFlag(flags, 'pre', 5);
  const postSec = parseNumberFlag(flags, 'post', 5);

  if (!Number.isFinite(atSec)) {
    throw new Error('Missing required numeric flag: --at');
  }

  const manifest = loadManifest(id);
  const output = flags.output
    ? path.resolve(String(flags.output))
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
