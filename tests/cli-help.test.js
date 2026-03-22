const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canSpawnNodeChildProcess,
  runCliText,
} = require('./helpers/cli-test-helpers');

const canSpawnChildren = canSpawnNodeChildProcess();

test('top-level help stays grouped and discoverable', { skip: !canSpawnChildren }, () => {
  const help = runCliText(['--help']);
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
  const clipHelp = runCliText(['clip', '--help']);
  assert.match(clipHelp, /--duration N/);
  assert.match(clipHelp, /Alias: --out <path>/);

  const frameHelp = runCliText(['frame', '--help']);
  assert.match(frameHelp, /--output <path>/);
  assert.match(frameHelp, /Alias: --out <path>/);
});
