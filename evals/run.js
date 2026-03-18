const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'video-cli.js');
const tmpRoot = path.join(repoRoot, '.tmp_eval');
const dataRoot = path.join(tmpRoot, 'data', 'videos');

main();

function main() {
  const mode = parseMode(process.argv.slice(2));
  resetTmp();

  const scenario = mode === 'live'
    ? createLiveScenario()
    : createMockScenario();

  const env = {
    ...process.env,
    VIDEO_CLI_DATA_ROOT: dataRoot,
  };

  if (mode === 'mock') {
    env.VIDEO_CLI_MOCK_GEMINI = '1';
    env.VIDEO_CLI_MOCK_DEEPGRAM = '1';
  }

  const checks = [];
  const config = runCli(['config'], env);
  addCheck(checks, 'default preset loads', config.preset === 'balanced', {
    preset: config.preset,
  });
  addCheck(checks, 'default providers are wired', config.ocr.provider === 'gemini' && config.transcribe.provider === 'deepgram', {
    ocrProvider: config.ocr.provider,
    transcribeProvider: config.transcribe.provider,
  });

  const ingest = runCli(['ingest', scenario.videoPath, '--watchpoints', '6'], env);
  addCheck(checks, 'ingest creates a video id', typeof ingest.id === 'string' && ingest.id.length > 0, {
    id: ingest.id,
  });
  addCheck(checks, 'ingest records watchpoints', Array.isArray(ingest.watchpoints) && ingest.watchpoints.length >= 3, {
    watchpointCount: ingest.watchpoints?.length ?? 0,
  });

  const bundle = runCli(['bundle', ingest.id, '--limit', '3'], env);
  addCheck(checks, 'bundle materializes watchpoints', Array.isArray(bundle.watchpoints) && bundle.watchpoints.length === 3, {
    watchpointCount: bundle.watchpoints?.length ?? 0,
  });

  const ocr = runCli(['ocr', ingest.id, '--limit', String(scenario.ocrLimit)], env);
  addCheck(checks, 'ocr returns at least one item', Array.isArray(ocr.items) && ocr.items.length >= 1, {
    itemCount: ocr.items?.length ?? 0,
  });
  addCheck(checks, 'ocr contains expected marker text', ocr.items.some(item => scenario.ocrPattern.test(item.text)), {
    texts: ocr.items.map(item => item.text),
  });

  const transcript = runCli([
    'transcribe',
    ingest.id,
    '--chunk-seconds', String(scenario.chunkSeconds),
    '--limit', '1',
    '--trim-silence',
    '--min-silence', String(scenario.minSilenceSec),
    '--pad', String(scenario.padSec),
  ], env);

  const transcriptItem = transcript.items?.[0] || {};
  addCheck(checks, 'transcribe returns utterances', Array.isArray(transcriptItem.utterances) && transcriptItem.utterances.length >= scenario.minUtterances, {
    utteranceCount: transcriptItem.utterances?.length ?? 0,
  });
  addCheck(checks, 'transcribe returns timestamped words', Array.isArray(transcriptItem.words) && transcriptItem.words.length >= scenario.minWords, {
    wordCount: transcriptItem.words?.length ?? 0,
  });
  addCheck(checks, 'transcript contains expected marker text', scenario.transcriptPattern.test(transcriptItem.text || ''), {
    excerpt: String(transcriptItem.text || '').slice(0, 240),
  });

  const grep = runCli(['grep', ingest.id, scenario.grepQuery], env);
  addCheck(checks, 'grep returns at least one match', grep.matchCount >= scenario.minGrepMatches, {
    matchCount: grep.matchCount,
  });
  addCheck(checks, 'grep returns narrow timestamped transcript spans', grep.matches.some(match => (
    match.source === 'transcript' &&
    typeof match.startSec === 'number' &&
    typeof match.endSec === 'number' &&
    (match.endSec - match.startSec) <= scenario.maxMatchWindowSec
  )), {
    matches: grep.matches,
  });

  const passed = checks.filter(check => check.pass).length;
  const summary = {
    mode,
    score: Number((passed / checks.length).toFixed(3)),
    passed,
    failed: checks.length - passed,
    videoPath: scenario.videoPath,
    checks,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function parseMode(argv) {
  const modeFlagIndex = argv.findIndex(arg => arg === '--mode');
  if (modeFlagIndex >= 0) {
    const value = argv[modeFlagIndex + 1];
    if (value === 'mock' || value === 'live') {
      return value;
    }
    throw new Error(`Invalid --mode value: ${value}`);
  }
  return 'mock';
}

function addCheck(checks, name, pass, details) {
  checks.push({
    name,
    pass: Boolean(pass),
    details: details || null,
  });
}

function resetTmp() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function createMockScenario() {
  const videoPath = path.join(tmpRoot, 'mock-sample.mp4');
  createMockVideo(videoPath);
  return {
    videoPath,
    ocrLimit: 2,
    ocrPattern: /mock ocr/i,
    chunkSeconds: 3,
    minSilenceSec: 0.5,
    padSec: 0,
    minUtterances: 2,
    minWords: 4,
    transcriptPattern: /mock deepgram transcript/i,
    grepQuery: 'mock',
    minGrepMatches: 1,
    maxMatchWindowSec: 5,
  };
}

function createLiveScenario() {
  if (process.platform !== 'win32') {
    throw new Error('Live eval asset generation currently requires Windows.');
  }

  const framePath = path.join(tmpRoot, 'frame.png');
  const speechPath = path.join(tmpRoot, 'speech.wav');
  const videoPath = path.join(tmpRoot, 'live-sample.mp4');

  runPowerShell("Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.SetOutputToWaveFile('" + speechPath + "'); $synth.Speak('Hello from video cli. This is a real transcription test.'); $synth.Dispose()");
  runPowerShell("Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap 1280,720; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::FromArgb(245,244,238)); $font1 = New-Object System.Drawing.Font('Arial', 42, [System.Drawing.FontStyle]::Bold); $font2 = New-Object System.Drawing.Font('Arial', 26); $brush = [System.Drawing.Brushes]::Black; $g.DrawString('VIDEO CLI LIVE TEST', $font1, $brush, 80, 180); $g.DrawString('Gemini OCR should read this frame.', $font2, $brush, 80, 280); $g.DrawString('Deepgram should transcribe the audio track.', $font2, $brush, 80, 330); $bmp.Save('" + framePath + "', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose();");

  runProcess('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', framePath,
    '-i', speechPath,
    '-c:v', 'libx264',
    '-t', '6',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    videoPath,
  ]);

  return {
    videoPath,
    ocrLimit: 1,
    ocrPattern: /VIDEO CLI LIVE TEST/i,
    chunkSeconds: 6,
    minSilenceSec: 0.6,
    padSec: 0.15,
    minUtterances: 2,
    minWords: 8,
    transcriptPattern: /real transcription test/i,
    grepQuery: 'transcription',
    minGrepMatches: 1,
    maxMatchWindowSec: 8,
  };
}

function createMockVideo(outputPath) {
  runProcess('ffmpeg', [
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
  ]);
}

function runCli(args, env) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI failed with code ${result.status}`);
  }

  return JSON.parse(result.stdout);
}

function runProcess(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
}

function runPowerShell(command) {
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'PowerShell command failed');
  }
}
