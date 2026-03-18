const path = require('node:path');
const fs = require('node:fs');

const {
  createArtifactPath,
  ensureDataRoot,
  getRepoRoot,
  loadManifest,
  listManifests,
  saveManifest,
} = require('./lib/store');
const { getRuntimeConfig } = require('./lib/config');
const {
  buildEvidenceBundle,
  buildSpeechSegments,
  buildVideoId,
  detectSilences,
  detectSceneChanges,
  extractAudioChunk,
  extractClip,
  extractFrame,
  getFileIdentity,
  materializeWatchpoints,
  pickWatchpoints,
  probeVideo,
} = require('./lib/media');
const { readArtifactJson, writeArtifactJson } = require('./lib/artifacts');
const { createProvider } = require('./lib/providers');
const { renderBundleMarkdown } = require('./lib/render');
const { findMatches } = require('./lib/search');

async function main(argv) {
  ensureDataRoot();
  const config = getRuntimeConfig(getRepoRoot());

  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const { positionals, flags } = parseArgs(rest);

  switch (command) {
    case 'ingest':
      return runIngest(positionals, flags);
    case 'list':
      return runList();
    case 'config':
      return runConfig(config);
    case 'inspect':
      return runInspect(positionals);
    case 'timeline':
      return runTimeline(positionals);
    case 'watchpoints':
      return runWatchpoints(positionals, flags);
    case 'bundle':
      return runBundle(positionals, flags);
    case 'brief':
      return runBrief(positionals, flags);
    case 'ocr':
      return runOcr(positionals, flags, config);
    case 'transcribe':
      return runTranscribe(positionals, flags, config);
    case 'grep':
      return runGrep(positionals);
    case 'frame':
      return runFrame(positionals, flags);
    case 'clip':
      return runClip(positionals, flags);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  const lines = [
    'video-cli',
    '',
    'Commands:',
    '  video-cli ingest <file> [--watchpoints N] [--scene-threshold N]',
    '  video-cli list',
    '  video-cli config',
    '  video-cli inspect <video-id>',
    '  video-cli timeline <video-id>',
    '  video-cli watchpoints <video-id> [--limit N] [--materialize]',
    '  video-cli bundle <video-id> [--limit N]',
    '  video-cli brief <video-id> [--limit N] [--output <path>]',
    '  video-cli ocr <video-id> [--limit N] [--provider <name>] [--model <name>]',
    '  video-cli transcribe <video-id> [--chunk-seconds N] [--limit N] [--provider <name>] [--model <name>] [--trim-silence]',
    '  video-cli grep <video-id> <query>',
    '  video-cli frame <video-id> --at <seconds> [--output <path>]',
    '  video-cli clip <video-id> --at <seconds> [--pre N] [--post N] [--output <path>]',
  ];
  console.log(lines.join('\n'));
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const eqIndex = withoutPrefix.indexOf('=');
    if (eqIndex >= 0) {
      flags[withoutPrefix.slice(0, eqIndex)] = withoutPrefix.slice(eqIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[withoutPrefix] = next;
      i += 1;
      continue;
    }

    flags[withoutPrefix] = true;
  }

  return { positionals, flags };
}

function requirePositional(positionals, index, name) {
  const value = positionals[index];
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function parseNumberFlag(flags, name, fallback) {
  if (!(name in flags)) {
    return fallback;
  }
  const value = Number(flags[name]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for --${name}: ${flags[name]}`);
  }
  return value;
}

function parseBooleanFlag(flags, name, fallback) {
  if (!(name in flags)) {
    return fallback;
  }

  const value = flags[name];
  if (value === true) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value for --${name}: ${flags[name]}`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function runIngest(positionals, flags) {
  const inputFile = requirePositional(positionals, 0, '<file>');
  const resolvedInput = path.resolve(inputFile);
  const sceneThreshold = parseNumberFlag(flags, 'scene-threshold', 0.35);
  const requestedWatchpoints = parseNumberFlag(flags, 'watchpoints', 12);

  const identity = getFileIdentity(resolvedInput);
  const id = buildVideoId(identity);
  const probe = probeVideo(resolvedInput);
  const durationSec = Number(probe.format.duration || 0);
  const changePointsSec = detectSceneChanges(resolvedInput, sceneThreshold);
  const watchpoints = pickWatchpoints(durationSec, changePointsSec, requestedWatchpoints);

  const videoStream = probe.streams.find(stream => stream.codec_type === 'video') || null;
  const audioStream = probe.streams.find(stream => stream.codec_type === 'audio') || null;

  const manifest = {
    id,
    importedAt: new Date().toISOString(),
    repoRoot: getRepoRoot(),
    sourcePath: resolvedInput,
    sourceName: path.basename(resolvedInput),
    file: identity,
    media: {
      formatName: probe.format.format_name || null,
      durationSec,
      bitRate: probe.format.bit_rate ? Number(probe.format.bit_rate) : null,
      sizeBytes: probe.format.size ? Number(probe.format.size) : identity.sizeBytes,
      video: videoStream ? {
        codec: videoStream.codec_name || null,
        width: videoStream.width || null,
        height: videoStream.height || null,
        fps: parseFrameRate(videoStream.avg_frame_rate),
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name || null,
        channels: audioStream.channels || null,
        sampleRate: audioStream.sample_rate ? Number(audioStream.sample_rate) : null,
      } : null,
    },
    sceneDetection: {
      threshold: sceneThreshold,
      changePointsSec,
    },
    watchpoints,
  };

  saveManifest(manifest);
  printJson(manifest);
}

async function runList() {
  const manifests = listManifests().map(manifest => ({
    id: manifest.id,
    sourceName: manifest.sourceName,
    durationSec: manifest.media.durationSec,
    watchpointCount: manifest.watchpoints.length,
    changePointCount: manifest.sceneDetection.changePointsSec.length,
    importedAt: manifest.importedAt,
  }));
  printJson(manifests);
}

async function runConfig(config) {
  printJson(config);
}

async function runInspect(positionals) {
  const id = requirePositional(positionals, 0, '<video-id>');
  printJson(loadManifest(id));
}

async function runTimeline(positionals) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  printJson({
    id: manifest.id,
    durationSec: manifest.media.durationSec,
    changePointsSec: manifest.sceneDetection.changePointsSec,
    watchpoints: manifest.watchpoints,
  });
}

async function runWatchpoints(positionals, flags) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', Number.POSITIVE_INFINITY);
  const manifest = loadManifest(id);

  const items = Number.isFinite(limit)
    ? manifest.watchpoints.slice(0, Math.max(0, Math.floor(limit)))
    : manifest.watchpoints.slice();

  if (flags.materialize) {
    const materialized = materializeWatchpoints(manifest, items);
    printJson({
      id,
      durationSec: manifest.media.durationSec,
      watchpoints: materialized,
    });
    return;
  }

  printJson({
    id,
    durationSec: manifest.media.durationSec,
    watchpoints: items,
  });
}

async function runBundle(positionals, flags) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', 8);
  const manifest = loadManifest(id);
  const bundle = buildEvidenceBundle(manifest, Math.max(1, Math.floor(limit)));
  printJson(bundle);
}

async function runBrief(positionals, flags) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', 8);
  const manifest = loadManifest(id);
  const bundle = buildEvidenceBundle(manifest, Math.max(1, Math.floor(limit)));
  const output = flags.output
    ? path.resolve(String(flags.output))
    : createArtifactPath(id, '', 'brief.md');

  require('node:fs').writeFileSync(output, renderBundleMarkdown(bundle), 'utf8');
  printJson({
    id,
    output,
    watchpointCount: bundle.watchpoints.length,
  });
}

async function runOcr(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', config.ocr.watchpointLimit);
  const manifest = loadManifest(id);
  const providerName = String(flags.provider || config.ocr.provider);
  const provider = createProvider(providerName);
  const model = String(flags.model || config.ocr.model);
  const selected = manifest.watchpoints.slice(0, Math.max(1, Math.floor(limit)));
  const watchpoints = materializeWatchpoints(manifest, selected);
  const results = [];

  for (const item of watchpoints) {
    const ocr = await provider.ocrImage({
      imagePath: item.framePath,
      model,
      prompt: [
        'Extract the visible text from this video frame.',
        'Return plain text only.',
        'Keep line breaks when they help preserve structure.',
        'If there is no meaningful visible text, return an empty string.',
      ].join(' '),
    });

    results.push({
      atSec: item.atSec,
      kind: item.kind,
      reason: item.reason,
      framePath: item.framePath,
      text: ocr.text.trim(),
    });
  }

  const payload = {
    id,
    provider: providerName,
    model,
    createdAt: new Date().toISOString(),
    items: results,
  };

  writeArtifactJson(id, 'ocr.json', payload);
  printJson(payload);
}

async function runTranscribe(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const chunkSeconds = parseNumberFlag(flags, 'chunk-seconds', config.transcribe.chunkSeconds);
  const limit = parseNumberFlag(flags, 'limit', Number.POSITIVE_INFINITY);
  const manifest = loadManifest(id);
  const providerName = String(flags.provider || config.transcribe.provider);
  const provider = createProvider(providerName);
  const model = String(flags.model || config.transcribe.model);
  const trimSilence = parseBooleanFlag(flags, 'trim-silence', config.transcribe.trimSilence);
  const minSilenceSec = parseNumberFlag(flags, 'min-silence', config.transcribe.minSilenceSec);
  const padSec = parseNumberFlag(flags, 'pad', config.transcribe.padSec);
  const silenceNoiseDb = parseNumberFlag(flags, 'silence-noise-db', config.transcribe.silenceNoiseDb);
  const diarize = parseBooleanFlag(flags, 'diarize', config.transcribe.diarize);
  const utterances = parseBooleanFlag(flags, 'utterances', config.transcribe.utterances);
  const smartFormat = parseBooleanFlag(flags, 'smart-format', config.transcribe.smartFormat);
  const punctuate = parseBooleanFlag(flags, 'punctuate', config.transcribe.punctuate);
  const detectLanguage = parseBooleanFlag(flags, 'detect-language', config.transcribe.detectLanguage);
  const language = flags.language ? String(flags.language) : config.transcribe.language;
  const chunks = buildAudioChunks(manifest.media.durationSec, chunkSeconds, limit);
  const results = [];

  for (const chunk of chunks) {
    const silences = trimSilence
      ? detectSilences(manifest.sourcePath, chunk.startSec, chunk.endSec - chunk.startSec, {
        minSilenceSec,
        silenceNoiseDb,
      })
      : [];

    const segments = trimSilence
      ? buildSpeechSegments(chunk.startSec, chunk.endSec, silences, { padSec })
      : [{
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        durationSec: Number((chunk.endSec - chunk.startSec).toFixed(3)),
      }];

    const segmentResults = [];
    const words = [];
    const utteranceItems = [];

    for (const [index, segment] of segments.entries()) {
      if (segment.durationSec <= 0.05) {
        continue;
      }

      const audioPath = createArtifactPath(
        id,
        'audio',
        `segment-${formatSecondsForFile(segment.startSec)}-${formatSecondsForFile(segment.endSec)}.mp3`
      );

      extractAudioChunk(manifest.sourcePath, segment.startSec, segment.durationSec, audioPath);

      const transcript = await provider.transcribeAudio({
        audioPath,
        model,
        diarize,
        utterances,
        smartFormat,
        punctuate,
        detectLanguage,
        language,
        prompt: [
          'Transcribe the spoken audio in this clip.',
          'Return plain text only.',
          'Do not add commentary or analysis.',
          'If there is no speech, return an empty string.',
        ].join(' '),
      });

      const remappedWords = remapTimedItems(transcript.words || [], segment.startSec, 'word');
      const remappedUtterances = remapTimedItems(transcript.utterances || [], segment.startSec, 'utterance');
      words.push(...remappedWords);
      utteranceItems.push(...remappedUtterances);

      segmentResults.push({
        index,
        startSec: segment.startSec,
        endSec: segment.endSec,
        durationSec: segment.durationSec,
        audioPath,
        text: String(transcript.text || '').trim(),
        wordCount: remappedWords.length,
        utteranceCount: remappedUtterances.length,
      });
    }

    const speechDurationSec = Number(
      segmentResults.reduce((sum, item) => sum + item.durationSec, 0).toFixed(3)
    );
    const totalDurationSec = Number((chunk.endSec - chunk.startSec).toFixed(3));
    const skippedSilenceSec = Number(Math.max(0, totalDurationSec - speechDurationSec).toFixed(3));

    results.push({
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      trimSilenceApplied: trimSilence,
      speechDurationSec,
      skippedSilenceSec,
      silences: silences.map(item => ({
        startSec: Number((chunk.startSec + item.startSec).toFixed(3)),
        endSec: Number((chunk.startSec + item.endSec).toFixed(3)),
        durationSec: item.durationSec,
      })),
      segments: segmentResults,
      text: segmentResults.map(item => item.text).filter(Boolean).join('\n').trim(),
      words,
      utterances: utteranceItems,
    });
  }

  const payload = {
    id,
    provider: providerName,
    model,
    chunkSeconds,
    trimSilence,
    minSilenceSec,
    padSec,
    silenceNoiseDb,
    diarize,
    utterances,
    smartFormat,
    punctuate,
    detectLanguage,
    language,
    createdAt: new Date().toISOString(),
    items: results,
  };

  writeArtifactJson(id, 'transcript.json', payload);
  printJson(payload);
}

async function runGrep(positionals) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<query>');
  const manifest = loadManifest(id);
  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');
  const matches = findMatches({ query, ocr, transcript });

  printJson({
    id: manifest.id,
    query,
    matchCount: matches.length,
    matches,
  });
}

async function runFrame(positionals, flags) {
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

async function runClip(positionals, flags) {
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

function parseFrameRate(value) {
  if (!value || typeof value !== 'string' || !value.includes('/')) {
    return null;
  }

  const [numeratorRaw, denominatorRaw] = value.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function formatSecondsForFile(value) {
  return value.toFixed(3).replace('.', '_');
}

function buildAudioChunks(durationSec, chunkSeconds, limit) {
  const items = [];
  const maxChunks = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
  const safeChunkSeconds = Math.max(1, chunkSeconds);

  for (let startSec = 0; startSec < durationSec && items.length < maxChunks; startSec += safeChunkSeconds) {
    const endSec = Math.min(durationSec, startSec + safeChunkSeconds);
    items.push({
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
    });
  }

  if (items.length === 0 && durationSec === 0) {
    items.push({ startSec: 0, endSec: safeChunkSeconds });
  }

  return items;
}

function remapTimedItems(items, offsetSec, kind) {
  return (items || []).map(item => {
    const startSec = Number((offsetSec + Number(item.startSec || 0)).toFixed(3));
    const endSec = Number((offsetSec + Number(item.endSec || 0)).toFixed(3));
    if (kind === 'word') {
      return {
        word: item.word || '',
        startSec,
        endSec,
        confidence: item.confidence ?? null,
        speaker: item.speaker ?? null,
        punctuatedWord: item.punctuatedWord ?? null,
      };
    }

    return {
      startSec,
      endSec,
      confidence: item.confidence ?? null,
      speaker: item.speaker ?? null,
      transcript: item.transcript || '',
    };
  });
}

module.exports = {
  main,
};
