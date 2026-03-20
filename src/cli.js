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
  detectSceneChangesWithScores,
  detectSceneChanges,
  extractAudioChunk,
  extractClip,
  extractFrame,
  getFileIdentity,
  materializeWatchpoints,
  pickAdaptiveWatchpoints,
  pickWatchpoints,
  probeVideo,
} = require('./lib/media');
const { readArtifactJson, writeArtifactJson } = require('./lib/artifacts');
const { createProvider } = require('./lib/providers');
const { renderBundleMarkdown } = require('./lib/render');
const { findMatches, semanticSearch, getContext, buildChapters, findNext } = require('./lib/search');
const { buildEmbeddings, embedText } = require('./lib/embed');
const { askQuestion } = require('./lib/ask');
const { describeFrames, extractDenseFrames, generateEvalQueries } = require('./lib/describe');
const { batchAsync } = require('./lib/net');

// Commands whose first positional is a video-id and can default to VIDEO_CLI_ID
const VIDEO_ID_COMMANDS = new Set([
  'ask', 'inspect', 'timeline', 'watchpoints', 'bundle', 'brief',
  'ocr', 'transcribe', 'grep', 'frame', 'clip', 'embed', 'search',
  'context', 'chapters', 'next', 'describe', 'status',
  'eval:generate', 'eval:run',
]);

async function main(argv) {
  ensureDataRoot();
  const config = getRuntimeConfig(getRepoRoot());

  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const { positionals, flags } = parseArgs(rest);

  // Default video-id from VIDEO_CLI_ID env var
  if (process.env.VIDEO_CLI_ID && VIDEO_ID_COMMANDS.has(command) && positionals.length === 0) {
    positionals.unshift(process.env.VIDEO_CLI_ID);
  }

  switch (command) {
    case 'ingest':
      return runIngest(positionals, flags);
    case 'setup':
      return runSetup(positionals, flags, config);
    case 'ask':
      return runAsk(positionals, flags, config);
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
    case 'embed':
      return runEmbed(positionals, flags, config);
    case 'search':
      return runSearch(positionals, flags, config);
    case 'context':
      return runContext(positionals, flags, config);
    case 'chapters':
      return runChapters(positionals);
    case 'next':
      return runNext(positionals, flags);
    case 'describe':
      return runDescribe(positionals, flags, config);
    case 'status':
      return runStatus(positionals);
    case 'eval:generate':
      return runEvalGenerate(positionals, flags, config);
    case 'eval:run':
      return runEvalRun(positionals, flags, config);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  const lines = [
    'video-cli \u2014 video REPL for AI agents',
    '',
    'Quick Start:',
    '  setup <file>                    Full pipeline: ingest + transcribe + ocr + embed',
    '  ask <video-id> <question>       Answer with grounded citations',
    '',
    'Navigation:',
    '  search <video-id> <query>       Semantic + lexical search',
    '  context <video-id> --at T       Everything around a timestamp',
    '  chapters <video-id>             Semantic chapter segmentation',
    '  next <video-id> --from T        Next significant moment',
    '  grep <video-id> <text>          Exact substring search',
    '',
    'Extraction:',
    '  frame <video-id> --at T         Extract a single frame (JPG)',
    '  clip <video-id> --at T          Extract a video clip',
    '',
    'Pipeline (run individually if needed):',
    '  ingest <file>                   Probe video + adaptive watchpoints',
    '  transcribe <video-id>           Audio \u2192 transcript (Deepgram)',
    '  ocr <video-id>                  Frames \u2192 text (Gemini)',
    '  embed <video-id>                Build embeddings (Gemini)',
    '  describe <video-id>             Dense frame descriptions',
    '',
    'Inspection:',
    '  list                            All ingested videos',
    '  status <video-id>               Artifact readiness + pipeline status',
    '  inspect <video-id>              Full manifest',
    '  timeline <video-id>             Watchpoints + scene changes',
    '  config                          Current config',
    '',
    "Use 'video-cli <command> --help' for details on a specific command.",
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
  const adaptive = parseBooleanFlag(flags, 'adaptive', true);
  const sceneThreshold = parseNumberFlag(flags, 'scene-threshold', 0.35);
  const requestedWatchpoints = parseNumberFlag(flags, 'watchpoints', 12);

  const identity = getFileIdentity(resolvedInput);
  const id = buildVideoId(identity);
  const probe = probeVideo(resolvedInput);
  const durationSec = Number(probe.format.duration || 0);

  let changePointsSec;
  let watchpoints;
  let sceneScores = null;

  if (adaptive) {
    sceneScores = detectSceneChangesWithScores(resolvedInput);
    changePointsSec = sceneScores.filter(e => e.score >= sceneThreshold).map(e => e.atSec);
    watchpoints = pickAdaptiveWatchpoints(durationSec, sceneScores, {
      minCount: Math.max(6, Math.ceil(durationSec / 60)),
      maxCount: Math.max(requestedWatchpoints, Math.ceil(durationSec / 15)),
      sigmaMultiplier: 1.0,
      minGapSec: 3,
    });
  } else {
    changePointsSec = detectSceneChanges(resolvedInput, sceneThreshold);
    watchpoints = pickWatchpoints(durationSec, changePointsSec, requestedWatchpoints);
  }

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

async function runSetup(positionals, flags, config) {
  const inputFile = requirePositional(positionals, 0, '<file>');

  // Cost estimate based on probe duration (reuses probe from ingest)
  const resolvedInput = path.resolve(inputFile);
  const probeResult = probeVideo(resolvedInput);
  const estDuration = Number(probeResult.format.duration || 0);
  const estMinutes = estDuration / 60;
  const estTranscribe = estMinutes * 0.004;
  const estOcr = 0.003;
  const estEmbed = 0.001;
  const estTotal = estTranscribe + estOcr + estEmbed;
  console.error(
    `setup: estimated cost ~$${estTotal.toFixed(4)} ` +
    `(transcribe ~$${estTranscribe.toFixed(4)}, OCR ~$${estOcr.toFixed(4)}, embed ~$${estEmbed.toFixed(4)})`
  );

  // Step 1: Ingest
  console.error('setup: ingesting...');
  await runIngest(positionals, flags);

  // Find the ID from the ingested file
  const identity = getFileIdentity(resolvedInput);
  const id = buildVideoId(identity);

  // Step 2: Transcribe
  console.error('setup: transcribing...');
  await runTranscribe([id], { 'trim-silence': true }, config);

  // Step 3: OCR
  console.error('setup: running OCR...');
  await runOcr([id], {}, config);

  // Step 4: Embed
  console.error('setup: embedding...');
  await runEmbed([id], {}, config);

  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const embeddings = readArtifactJson(id, 'embeddings.json');

  printJson({
    id,
    sourceName: manifest.sourceName,
    durationSec: manifest.media.durationSec,
    watchpoints: manifest.watchpoints.length,
    utterances: transcript ? transcript.items.reduce((s, i) => s + (i.utterances || []).length, 0) : 0,
    ocrItems: ocr ? ocr.items.length : 0,
    embeddings: embeddings ? embeddings.items.length : 0,
    ready: true,
  });
}

async function runAsk(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<question>');

  const embeddings = readArtifactJson(id, 'embeddings.json');
  if (!embeddings || !Array.isArray(embeddings.items) || embeddings.items.length === 0) {
    throw new Error('No embeddings found. Run `video-cli setup` or `video-cli embed` first.');
  }

  const apiKey = process.env.GEMINI_API_KEY || null;
  const queryVec = await embedText({
    apiKey,
    text: query,
    model: config.embed.model,
    taskType: config.embed.taskTypeQuery,
    dimensions: embeddings.dimensions,
  });

  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');
  let descriptions = readArtifactJson(id, 'descriptions.json');
  const manifest = loadManifest(id);
  const lexicalMatches = findMatches({ query, ocr, transcript });

  const searchResults = semanticSearch({
    query, queryVec, embeddings: embeddings.items,
    lexicalMatches, descriptions, topK: 5,
  });

  // Gather context around the top result
  const topAt = searchResults[0]
    ? (searchResults[0].startSec ?? searchResults[0].atSec ?? 0)
    : 0;

  let context = null;
  if (topAt > 0 || searchResults.length > 0) {
    // JIT enrich if source exists and no descriptions for this window
    const startSec = Math.max(0, topAt - 10);
    const endSec = topAt + 15;

    if (manifest.sourcePath && fs.existsSync(manifest.sourcePath)) {
      const hasCoverage = descriptions && Array.isArray(descriptions.items) &&
        descriptions.items.some(d => d.atSec >= startSec && d.atSec <= endSec);
      if (!hasCoverage) {
        const { enrichRegion } = require('./lib/describe');
        const descModel = config.ocr.model || 'gemini-3.1-flash-lite-preview';
        const newItems = await enrichRegion({
          apiKey, model: descModel,
          sourcePath: manifest.sourcePath, videoId: id,
          startSec, endSec, intervalSec: 2,
          existingDescriptions: descriptions,
        });
        if (newItems.length > 0) {
          const desc = descriptions || { id, model: descModel, intervalSec: 2, createdAt: new Date().toISOString(), frameCount: 0, items: [] };
          desc.items.push(...newItems);
          desc.items.sort((a, b) => a.atSec - b.atSec);
          desc.frameCount = desc.items.length;
          writeArtifactJson(id, 'descriptions.json', desc);
        }
      }
    }

    // Re-read only if enrichment wrote new items, otherwise use what we have
    if (!descriptions) descriptions = readArtifactJson(id, 'descriptions.json');
    context = getContext({ atSec: topAt, windowSec: 12, transcript, ocr, descriptions, manifest });
  }

  const askModel = config.ocr.model || 'gemini-3.1-flash-lite-preview';
  const result = await askQuestion({
    apiKey, model: askModel, query, searchResults, context, videoId: id,
  });

  printJson({
    id,
    query,
    ...result,
  });
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

async function runStatus(positionals) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const hasTranscript = !!readArtifactJson(id, 'transcript.json');
  const hasOcr = !!readArtifactJson(id, 'ocr.json');
  const hasEmbeddings = !!readArtifactJson(id, 'embeddings.json');
  const hasDescriptions = !!readArtifactJson(id, 'descriptions.json');
  const readyForAsk = hasTranscript && hasOcr && hasEmbeddings;
  const readyForSearch = hasEmbeddings;

  printJson({
    id,
    sourceName: manifest.sourceName,
    durationSec: manifest.media.durationSec,
    artifacts: {
      transcript: hasTranscript,
      ocr: hasOcr,
      embeddings: hasEmbeddings,
      descriptions: hasDescriptions,
    },
    readyForAsk,
    readyForSearch,
  });
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
  const ocrPrompt = [
    'Extract the visible text from this video frame.',
    'Return plain text only.',
    'Keep line breaks when they help preserve structure.',
    'If there is no meaningful visible text, return an empty string.',
  ].join(' ');

  const results = await batchAsync(watchpoints, async (item) => {
    const ocr = await provider.ocrImage({
      imagePath: item.framePath,
      model,
      prompt: ocrPrompt,
    });

    return {
      atSec: item.atSec,
      kind: item.kind,
      reason: item.reason,
      framePath: item.framePath,
      text: ocr.text.trim(),
    };
  }, 5);

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

    // Phase 1: extract audio sequentially (disk I/O)
    const transcribePrompt = [
      'Transcribe the spoken audio in this clip.',
      'Return plain text only.',
      'Do not add commentary or analysis.',
      'If there is no speech, return an empty string.',
    ].join(' ');

    const prepared = [];
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
      prepared.push({ index, segment, audioPath });
    }

    // Phase 2: batch transcription API calls
    const transcripts = await batchAsync(prepared, (item) =>
      provider.transcribeAudio({
        audioPath: item.audioPath,
        model,
        diarize,
        utterances,
        smartFormat,
        punctuate,
        detectLanguage,
        language,
        prompt: transcribePrompt,
      }), 5);

    const audioEventItems = [];

    for (let i = 0; i < prepared.length; i += 1) {
      const { index, segment, audioPath } = prepared[i];
      const transcript = transcripts[i];

      const remappedWords = remapTimedItems(transcript.words || [], segment.startSec, 'word');
      const remappedUtterances = remapTimedItems(transcript.utterances || [], segment.startSec, 'utterance');
      words.push(...remappedWords);
      utteranceItems.push(...remappedUtterances);

      // Collect audio events (laughter, applause, music, etc.) with remapped timestamps
      if (Array.isArray(transcript.audioEvents)) {
        for (const event of transcript.audioEvents) {
          audioEventItems.push({
            event: event.event,
            startSec: Number((segment.startSec + event.startSec).toFixed(3)),
            endSec: Number((segment.startSec + event.endSec).toFixed(3)),
          });
        }
      }

      segmentResults.push({
        index,
        startSec: segment.startSec,
        endSec: segment.endSec,
        durationSec: segment.durationSec,
        audioPath,
        text: String(transcript.text || '').trim(),
        wordCount: remappedWords.length,
        utteranceCount: remappedUtterances.length,
        languageCode: transcript.languageCode || null,
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
      audioEvents: audioEventItems,
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

async function runEmbed(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const embedConfig = { ...config.embed };
  const dimensions = parseNumberFlag(flags, 'dimensions', embedConfig.dimensions);
  embedConfig.dimensions = dimensions;

  const sources = { ...embedConfig.sources };
  if (parseBooleanFlag(flags, 'no-transcript', false)) {
    sources.transcript = false;
  }
  if (parseBooleanFlag(flags, 'no-ocr', false)) {
    sources.ocr = false;
  }
  if (parseBooleanFlag(flags, 'no-frames', false)) {
    sources.frames = false;
  }
  embedConfig.sources = sources;

  const ocr = sources.ocr ? readArtifactJson(id, 'ocr.json') : null;
  const transcript = sources.transcript ? readArtifactJson(id, 'transcript.json') : null;

  if (sources.ocr && !ocr) {
    throw new Error('No ocr.json found. Run `video-cli ocr` first.');
  }
  if (sources.transcript && !transcript) {
    throw new Error('No transcript.json found. Run `video-cli transcribe` first.');
  }

  if (sources.frames) {
    const { createArtifactPath: getArtifactPath } = require('./lib/store');
    const withPaths = manifest.watchpoints.map(wp => {
      const framePath = getArtifactPath(
        id, 'watchpoints',
        `watchpoint-${String(wp.atSec.toFixed(3)).replace('.', '_')}.jpg`
      );
      return { ...wp, framePath };
    });

    const allExist = withPaths.every(wp => fs.existsSync(wp.framePath));
    if (allExist) {
      manifest.watchpoints = withPaths;
    } else {
      try {
        const selected = manifest.watchpoints.slice();
        const materialized = materializeWatchpoints(manifest, selected);
        manifest.watchpoints = materialized;
      } catch {
        manifest.watchpoints = withPaths.filter(wp => fs.existsSync(wp.framePath));
      }
    }
  }

  const apiKey = process.env.GEMINI_API_KEY || null;
  const items = await buildEmbeddings({
    apiKey,
    manifest,
    ocr,
    transcript,
    config: embedConfig,
  });

  const transcriptCount = items.filter(i => i.source === 'transcript').length;
  const ocrCount = items.filter(i => i.source === 'ocr').length;
  const frameCount = items.filter(i => i.source === 'frame').length;

  const payload = {
    id,
    provider: embedConfig.provider,
    model: embedConfig.model,
    dimensions,
    createdAt: new Date().toISOString(),
    sources: { transcript: transcriptCount, ocr: ocrCount, frames: frameCount },
    items,
  };

  writeArtifactJson(id, 'embeddings.json', payload);
  printJson({
    id,
    provider: embedConfig.provider,
    model: embedConfig.model,
    dimensions,
    totalEmbeddings: items.length,
    sources: { transcript: transcriptCount, ocr: ocrCount, frames: frameCount },
  });
}

async function runSearch(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<query>');
  const topK = parseNumberFlag(flags, 'top', 5);

  const embeddings = readArtifactJson(id, 'embeddings.json');
  if (!embeddings || !Array.isArray(embeddings.items) || embeddings.items.length === 0) {
    throw new Error('No embeddings.json found. Run `video-cli embed` first.');
  }

  const apiKey = process.env.GEMINI_API_KEY || null;
  const queryVec = await embedText({
    apiKey,
    text: query,
    model: config.embed.model,
    taskType: config.embed.taskTypeQuery,
    dimensions: embeddings.dimensions,
  });

  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');
  const lexicalMatches = findMatches({ query, ocr, transcript });

  const matches = semanticSearch({
    query,
    queryVec,
    embeddings: embeddings.items,
    lexicalMatches,
    descriptions,
    topK,
  });

  printJson({
    id,
    query,
    matchCount: matches.length,
    matches,
  });
}

async function runContext(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const atSec = parseNumberFlag(flags, 'at', Number.NaN);
  if (!Number.isFinite(atSec)) {
    throw new Error('Missing required numeric flag: --at');
  }
  const windowSec = parseNumberFlag(flags, 'window', 10);
  const enrich = parseBooleanFlag(flags, 'enrich', true);

  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  let descriptions = readArtifactJson(id, 'descriptions.json');

  // JIT enrichment: if source video exists and we don't have descriptions
  // for this window, generate them on demand and cache
  const startSec = Math.max(0, atSec - windowSec);
  const endSec = atSec + windowSec;

  if (enrich && manifest.sourcePath && fs.existsSync(manifest.sourcePath)) {
    const hasCoverage = descriptions && Array.isArray(descriptions.items) &&
      descriptions.items.some(d => d.atSec >= startSec && d.atSec <= endSec);

    if (!hasCoverage) {
      const { enrichRegion } = require('./lib/describe');
      const apiKey = process.env.GEMINI_API_KEY || null;
      const model = (config && config.ocr && config.ocr.model) || 'gemini-3.1-flash-lite-preview';

      const newItems = await enrichRegion({
        apiKey, model,
        sourcePath: manifest.sourcePath,
        videoId: id,
        startSec, endSec,
        intervalSec: 2,
        existingDescriptions: descriptions,
      });

      if (newItems.length > 0) {
        if (!descriptions) {
          descriptions = { id, model, intervalSec: 2, createdAt: new Date().toISOString(), frameCount: 0, items: [] };
        }
        descriptions.items.push(...newItems);
        descriptions.items.sort((a, b) => a.atSec - b.atSec);
        descriptions.frameCount = descriptions.items.length;
        writeArtifactJson(id, 'descriptions.json', descriptions);
      }
    }
  }

  const context = getContext({ atSec, windowSec, transcript, ocr, descriptions, manifest });
  printJson({ id, ...context });
}

async function runChapters(positionals) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');

  const chapters = buildChapters({ manifest, transcript, descriptions });
  printJson({ id, durationSec: manifest.media.durationSec, chapterCount: chapters.length, chapters });
}

async function runNext(positionals, flags) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const fromSec = parseNumberFlag(flags, 'from', Number.NaN);
  if (!Number.isFinite(fromSec)) {
    throw new Error('Missing required numeric flag: --from');
  }

  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');

  const next = findNext({ fromSec, transcript, ocr, descriptions, manifest });
  printJson({ id, fromSec, next });
}

async function runDescribe(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const intervalSec = parseNumberFlag(flags, 'interval', 2);
  const model = String(flags.model || config.ocr.model);
  const apiKey = process.env.GEMINI_API_KEY || null;
  const dryRun = parseBooleanFlag(flags, 'dry-run', false);
  const maxFrames = parseNumberFlag(flags, 'max-frames', 500);

  const frameCount = Math.ceil(manifest.media.durationSec / intervalSec);
  const estimatedCost = frameCount * 0.00002;

  if (frameCount > maxFrames) {
    throw new Error(
      `Frame count ${frameCount} exceeds --max-frames limit of ${maxFrames}. ` +
      `Estimated cost: ~$${estimatedCost.toFixed(4)}. ` +
      `Use --max-frames ${frameCount} to override.`
    );
  }

  if (dryRun) {
    printJson({
      id,
      dryRun: true,
      frameCount,
      intervalSec,
      estimatedCost: `~$${estimatedCost.toFixed(4)}`,
      message: `Dry run: ${frameCount} frames \u00d7 ~$0.00002/frame = ~$${estimatedCost.toFixed(4)} estimated cost`,
    });
    return;
  }

  const frames = extractDenseFrames(
    manifest.sourcePath, manifest.media.durationSec, intervalSec, id
  );

  const descriptions = await describeFrames({
    apiKey,
    manifest,
    frames,
    model,
    prompt: [
      'Describe what you see in this video frame in 2-3 sentences.',
      'Include: any on-screen text, UI elements, diagrams, people, and actions.',
      'Be specific about visual details. If there is text, quote it exactly.',
    ].join(' '),
  });

  const payload = {
    id,
    model,
    intervalSec,
    createdAt: new Date().toISOString(),
    frameCount: descriptions.length,
    items: descriptions,
  };

  writeArtifactJson(id, 'descriptions.json', payload);
  printJson({
    id,
    model,
    intervalSec,
    frameCount: descriptions.length,
    durationSec: manifest.media.durationSec,
  });
}

async function runEvalGenerate(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const model = String(flags.model || config.ocr.model);
  const apiKey = process.env.GEMINI_API_KEY || null;

  const descriptions = readArtifactJson(id, 'descriptions.json');
  const transcript = readArtifactJson(id, 'transcript.json');

  if (!descriptions) {
    throw new Error('No descriptions.json found. Run `video-cli describe` first.');
  }

  const queries = await generateEvalQueries({
    apiKey,
    model,
    descriptions: descriptions.items,
    transcript,
  });

  const payload = {
    id,
    model,
    createdAt: new Date().toISOString(),
    queryCount: queries.length,
    queries,
  };

  writeArtifactJson(id, 'eval-queries.json', payload);
  printJson({
    id,
    model,
    queryCount: queries.length,
    queries: queries.map(q => ({
      query: q.query,
      modality: q.modality,
      difficulty: q.difficulty,
      spanCount: q.groundTruthSpans.length,
    })),
  });
}

async function runEvalRun(positionals, flags, config) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const topK = parseNumberFlag(flags, 'top', 5);
  const apiKey = process.env.GEMINI_API_KEY || null;

  const evalData = readArtifactJson(id, 'eval-queries.json');
  const embeddings = readArtifactJson(id, 'embeddings.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');

  if (!evalData) {
    throw new Error('No eval-queries.json found. Run `video-cli eval:generate` first.');
  }
  if (!embeddings) {
    throw new Error('No embeddings.json found. Run `video-cli embed` first.');
  }

  const results = [];

  for (const evalQuery of evalData.queries) {
    const queryVec = await embedText({
      apiKey,
      text: evalQuery.query,
      model: config.embed.model,
      taskType: config.embed.taskTypeQuery,
      dimensions: embeddings.dimensions,
    });

    const lexicalMatches = findMatches({ query: evalQuery.query, ocr, transcript });
    const matches = semanticSearch({
      query: evalQuery.query,
      queryVec,
      embeddings: embeddings.items,
      lexicalMatches,
      descriptions: null,
      topK,
    });

    const bestIoU = computeBestIoU(matches, evalQuery.groundTruthSpans);
    const r1Hit = bestIoU.iou >= 0.5;
    const r1Loose = bestIoU.iou >= 0.3;

    const reciprocalRank = computeReciprocalRank(matches, evalQuery.groundTruthSpans, 0.3);

    results.push({
      query: evalQuery.query,
      modality: evalQuery.modality,
      difficulty: evalQuery.difficulty,
      groundTruthSpans: evalQuery.groundTruthSpans,
      topResult: matches[0] || null,
      bestIoU: bestIoU.iou,
      r1_iou50: r1Hit,
      r1_iou30: r1Loose,
      reciprocalRank,
      matchCount: matches.length,
    });
  }

  const totalQueries = results.length;
  const r1_50 = results.filter(r => r.r1_iou50).length / Math.max(1, totalQueries);
  const r1_30 = results.filter(r => r.r1_iou30).length / Math.max(1, totalQueries);
  const mrr = results.reduce((s, r) => s + r.reciprocalRank, 0) / Math.max(1, totalQueries);
  const meanIoU = results.reduce((s, r) => s + r.bestIoU, 0) / Math.max(1, totalQueries);

  const payload = {
    id,
    topK,
    createdAt: new Date().toISOString(),
    summary: {
      totalQueries,
      'R@1_IoU>=0.5': Number(r1_50.toFixed(4)),
      'R@1_IoU>=0.3': Number(r1_30.toFixed(4)),
      MRR: Number(mrr.toFixed(4)),
      meanIoU: Number(meanIoU.toFixed(4)),
    },
    results,
  };

  writeArtifactJson(id, 'eval-results.json', payload);
  printJson({
    id,
    summary: payload.summary,
    results: results.map(r => ({
      query: r.query,
      difficulty: r.difficulty,
      bestIoU: r.bestIoU,
      r1_iou50: r.r1_iou50,
      rr: r.reciprocalRank,
    })),
  });
}

function computeBestIoU(matches, groundTruthSpans) {
  let best = { iou: 0, matchIdx: -1, spanIdx: -1 };

  for (let mi = 0; mi < matches.length; mi += 1) {
    const m = matches[mi];
    const mStart = m.startSec ?? m.atSec ?? 0;
    const mEnd = m.endSec ?? (mStart + 5);

    for (let si = 0; si < groundTruthSpans.length; si += 1) {
      const gt = groundTruthSpans[si];
      const interStart = Math.max(mStart, gt.startSec);
      const interEnd = Math.min(mEnd, gt.endSec);
      const intersection = Math.max(0, interEnd - interStart);
      const union = (mEnd - mStart) + (gt.endSec - gt.startSec) - intersection;
      const iou = union > 0 ? Number((intersection / union).toFixed(4)) : 0;

      if (iou > best.iou) {
        best = { iou, matchIdx: mi, spanIdx: si };
      }
    }
  }

  return best;
}

function computeReciprocalRank(matches, groundTruthSpans, iouThreshold) {
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const mStart = m.startSec ?? m.atSec ?? 0;
    const mEnd = m.endSec ?? (mStart + 5);

    for (const gt of groundTruthSpans) {
      const interStart = Math.max(mStart, gt.startSec);
      const interEnd = Math.min(mEnd, gt.endSec);
      const intersection = Math.max(0, interEnd - interStart);
      const union = (mEnd - mStart) + (gt.endSec - gt.startSec) - intersection;
      const iou = union > 0 ? intersection / union : 0;

      if (iou >= iouThreshold) {
        return Number((1 / (i + 1)).toFixed(4));
      }
    }
  }
  return 0;
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
