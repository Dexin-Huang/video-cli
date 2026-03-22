const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'video-cli.js');
const canSpawnChildren = canSpawnNodeChildProcess();

test('top-level help stays grouped and discoverable', { skip: !canSpawnChildren }, () => {
  const help = runCli(['--help']);
  assert.match(help, /Quick Start:/);
  assert.match(help, /Navigation:/);
  assert.match(help, /Extraction:/);
  assert.match(help, /Pipeline \(run individually if needed\):/);
  assert.match(help, /Inspection:/);
  assert.match(help, /Evaluation:/);
  assert.match(help, /install --skills/);
  assert.match(help, /ocr <video-id>/);
  assert.match(help, /describe <video-id>/);
});

test('command help exposes the current surface area', { skip: !canSpawnChildren }, () => {
  const clipHelp = runCli(['clip', '--help']);
  assert.match(clipHelp, /--duration N/);
  assert.match(clipHelp, /Alias: --out <path>/);

  const frameHelp = runCli(['frame', '--help']);
  assert.match(frameHelp, /--output <path>/);
  assert.match(frameHelp, /Alias: --out <path>/);
});

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI failed with code ${result.status}`);
  }

  return result.stdout;
}

function canSpawnNodeChildProcess() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}
