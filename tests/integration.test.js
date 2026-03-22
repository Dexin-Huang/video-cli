const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'video-cli.js');
const tmpRoot = path.join(repoRoot, '.tmp_cli_test');
const dataRoot = path.join(tmpRoot, 'data', 'videos');
const canSpawnChildren = canSpawnNodeChildProcess();

test.before(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('ingest, list, inspect, frame, and clip work end to end', { skip: !canSpawnChildren }, () => {
  const config = runCli(['config']);
  assert.equal(config.preset, 'balanced');
  assert.equal(config.ocr.provider, 'gemini');
  assert.equal(config.transcribe.provider, 'gemini-transcribe');

  const sampleVideo = path.join(tmpRoot, 'sample.mp4');
  createSampleVideo(sampleVideo);

  const ingest = runCli(['ingest', sampleVideo, '--watchpoints', '6']);
  assert.equal(typeof ingest.id, 'string');
  assert.equal(ingest.sourceName, 'sample.mp4');
  assert.equal(ingest.watchpoints.length > 0, true);
  assert.equal(ingest.media.video.width, 320);

  const listed = runCli(['list']);
  assert.equal(Array.isArray(listed), true);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, ingest.id);

  const inspected = runCli(['inspect', ingest.id]);
  assert.equal(inspected.id, ingest.id);
  assert.equal(inspected.sourcePath, sampleVideo);

  const timeline = runCli(['timeline', ingest.id]);
  assert.equal(Array.isArray(timeline.watchpoints), true);
  assert.equal(Array.isArray(timeline.changePointsSec), true);

  const watchpoints = runCli(['watchpoints', ingest.id, '--limit', '3', '--materialize']);
  assert.equal(watchpoints.watchpoints.length, 3);
  assert.equal(fs.existsSync(watchpoints.watchpoints[0].framePath), true);

  const bundle = runCli(['bundle', ingest.id, '--limit', '4']);
  assert.equal(bundle.watchpoints.length, 4);
  assert.equal(fs.existsSync(bundle.watchpoints[0].framePath), true);
  assert.equal(typeof bundle.watchpoints[0].windowStartSec, 'number');
  assert.equal(typeof bundle.watchpoints[0].windowEndSec, 'number');

  const brief = runCli(['brief', ingest.id, '--limit', '4']);
  assert.equal(fs.existsSync(brief.output), true);
  const markdown = fs.readFileSync(brief.output, 'utf8');
  assert.match(markdown, /# Video Brief/);
  assert.match(markdown, /## Watchpoints/);
  assert.match(markdown, /video-cli clip/);

  const ocr = runCli(['ocr', ingest.id, '--limit', '2']);
  assert.equal(ocr.items.length, 2);
  assert.match(ocr.items[0].text, /mock ocr/);

  const transcript = runCli([
    'transcribe',
    ingest.id,
    '--chunk-seconds', '3',
    '--limit', '1',
    '--trim-silence',
    '--min-silence', '0.5',
    '--pad', '0',
  ]);
  assert.equal(transcript.items.length, 1);
  assert.equal(transcript.trimSilence, true);
  assert.equal(transcript.items[0].segments.length, 2);
  assert.equal(transcript.items[0].skippedSilenceSec > 0.9, true);
  assert.equal(transcript.items[0].words.length >= 4, true);
  assert.equal(transcript.items[0].utterances.length, 2);
  assert.match(transcript.items[0].text, /mock (deepgram|elevenlabs|gemini) transcript/);
  assert.equal(transcript.items[0].words[1].startSec > transcript.items[0].words[0].startSec, true);

  const analyze = runCli(['analyze', ingest.id, '--limit', '2']);
  assert.equal(analyze.frameCount, 2);
  assert.ok(analyze.ocrItems >= 0);
  assert.ok(analyze.descriptions >= 0);

  const grep = runCli(['grep', ingest.id, 'mock']);
  assert.equal(grep.matchCount >= 3, true);

  const embed = runCli(['embed', ingest.id]);
  assert.equal(typeof embed.totalEmbeddings, 'number');
  assert.equal(embed.totalEmbeddings > 0, true);
  assert.equal(embed.dimensions, 768);
  assert.equal(typeof embed.sources.transcript, 'number');
  assert.equal(typeof embed.sources.ocr, 'number');
  assert.equal(typeof embed.sources.frames, 'number');

  const search = runCli(['search', ingest.id, 'mock']);
  assert.equal(search.matchCount >= 1, true);
  assert.equal(typeof search.matches[0].score, 'number');

  const ask = runCli(['ask', ingest.id, 'what is in this video']);
  assert.equal(typeof ask.answer, 'string');
  assert.ok(Array.isArray(ask.citations));
  assert.ok(Array.isArray(ask.suggestedFollowUps));

  const frame = runCli(['frame', ingest.id, '--at', '1.25']);
  assert.equal(fs.existsSync(frame.output), true);

  const clip = runCli(['clip', ingest.id, '--at', '1.5', '--pre', '0.4', '--post', '0.6']);
  assert.equal(fs.existsSync(clip.output), true);
});

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      VIDEO_CLI_DATA_ROOT: dataRoot,
      VIDEO_CLI_MOCK_GEMINI: '1',
      VIDEO_CLI_MOCK_DEEPGRAM: '1',
      VIDEO_CLI_MOCK_ELEVENLABS: '1',
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI failed with code ${result.status}`);
  }

  return JSON.parse(result.stdout);
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
