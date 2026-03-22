const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'video-cli.js');

function runCliJson(args, options = {}) {
  const result = runCli(args, {
    ...options,
    env: {
      ...options.env,
    },
  });

  return JSON.parse(result.stdout);
}

function runCliText(args, options = {}) {
  const result = runCli(args, options);
  return result.stdout;
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI failed with code ${result.status}`);
  }

  return result;
}

function canSpawnNodeChildProcess() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}

function createSampleVideo(outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const result = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=red:s=320x240:d=1',
    '-f', 'lavfi',
    '-i', 'color=c=blue:s=320x240:d=1',
    '-f', 'lavfi',
    '-i', 'color=c=green:s=320x240:d=1',
    '-f', 'lavfi',
    '-i', 'sine=frequency=880:sample_rate=16000:duration=0.8',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=mono:sample_rate=16000:d=1',
    '-f', 'lavfi',
    '-i', 'sine=frequency=660:sample_rate=16000:duration=1.2',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]',
    '-map', '[v]',
    '-map', '[a]',
    outputPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create sample video');
  }
}

module.exports = {
  canSpawnNodeChildProcess,
  cliPath,
  createSampleVideo,
  repoRoot,
  runCliJson,
  runCliText,
};
