const path = require('node:path');
const fs = require('node:fs');

const {
  createArtifactPath,
  loadManifest,
  saveManifest,
} = require('../lib/store');
const {
  buildSpeechSegments,
  buildVideoId,
  detectSilences,
  detectSceneChangesWithScores,
  detectSceneChanges,
  extractAudioChunk,
  getFileIdentity,
  materializeWatchpoints,
  pickAdaptiveWatchpoints,
  pickWatchpoints,
  probeVideo,
} = require('../lib/media');
const { readArtifactJson, writeArtifactJson } = require('../lib/artifacts');
const { buildEmbeddings } = require('../lib/embed');
const { analyzeFrames, describeFrames, extractDenseFrames } = require('../lib/describe');
const { batchAsync } = require('../lib/net');

function createProvider(name) {
  switch (name) {
    case 'gemini':
      return require('../lib/gemini').createGeminiProvider();
    case 'gemini-transcribe':
      return require('../lib/gemini-transcribe').createGeminiTranscribeProvider();
    default:
      throw new Error(`Provider "${name}" is not implemented yet. Supported providers: gemini, gemini-transcribe.`);
  }
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

function formatSecondsForFile(value) {
  return value.toFixed(3).replace('.', '_');
}

async function runIngest(positionals, flags, { requirePositional, parseNumberFlag, parseBooleanFlag, printJson }) {
  const inputFile = requirePositional(positionals, 0, '<file>');
  const resolvedInput = path.resolve(inputFile);
  const adaptive = parseBooleanFlag(flags, 'adaptive', true);
  const sceneThreshold = parseNumberFlag(flags, 'scene-threshold', 0.35);
  const requestedWatchpoints = Object.prototype.hasOwnProperty.call(flags, 'watchpoints')
    ? parseNumberFlag(flags, 'watchpoints', Number.NaN)
    : null;

  const identity = getFileIdentity(resolvedInput);
  const id = buildVideoId(identity);
  const probe = probeVideo(resolvedInput);
  const durationSec = Number(probe.format.duration || 0);
  const autoWatchpointTarget = Math.max(6, Math.min(24, Math.ceil(Math.max(durationSec, 1) / 30)));
  const watchpointCap = Number.isFinite(requestedWatchpoints)
    ? Math.max(1, Math.floor(requestedWatchpoints))
    : null;

  let changePointsSec;
  let watchpoints;

  if (adaptive) {
    const sceneScores = detectSceneChangesWithScores(resolvedInput);
    changePointsSec = sceneScores.filter(e => e.score >= sceneThreshold).map(e => e.atSec);
    watchpoints = pickAdaptiveWatchpoints(durationSec, sceneScores, {
      minCount: watchpointCap === null
        ? Math.max(6, Math.ceil(durationSec / 60))
        : Math.min(watchpointCap, Math.max(3, Math.ceil(durationSec / 60))),
      maxCount: watchpointCap === null
        ? Math.max(autoWatchpointTarget, Math.ceil(durationSec / 15))
        : watchpointCap,
      sigmaMultiplier: 1.0,
      minGapSec: 3,
    });
  } else {
    changePointsSec = detectSceneChanges(resolvedInput, sceneThreshold);
    watchpoints = pickWatchpoints(durationSec, changePointsSec, watchpointCap ?? autoWatchpointTarget);
  }

  const videoStream = probe.streams.find(stream => stream.codec_type === 'video') || null;
  const audioStream = probe.streams.find(stream => stream.codec_type === 'audio') || null;

  const manifest = {
    id,
    importedAt: new Date().toISOString(),
    repoRoot: require('../lib/store').getRepoRoot(),
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

async function runTranscribe(positionals, flags, config, { requirePositional, parseNumberFlag, parseBooleanFlag, printJson }) {
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
  const transcribePrompt = 'Transcribe the spoken audio in this clip. Return plain text only. Do not add commentary or analysis. If there is no speech, return an empty string.';

  for (const chunk of chunks) {
    const silences = trimSilence
      ? detectSilences(manifest.sourcePath, chunk.startSec, chunk.endSec - chunk.startSec, { minSilenceSec, silenceNoiseDb })
      : [];
    const segments = trimSilence
      ? buildSpeechSegments(chunk.startSec, chunk.endSec, silences, { padSec })
      : [{ startSec: chunk.startSec, endSec: chunk.endSec, durationSec: Number((chunk.endSec - chunk.startSec).toFixed(3)) }];

    const segmentResults = [];
    const words = [];
    const utteranceItems = [];

    const prepared = [];
    for (const [index, segment] of segments.entries()) {
      if (segment.durationSec <= 0.05) continue;
      const audioPath = createArtifactPath(id, 'audio', `segment-${formatSecondsForFile(segment.startSec)}-${formatSecondsForFile(segment.endSec)}.mp3`);
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
      }), 5, 'transcribing');

    const audioEventItems = [];

    for (let i = 0; i < prepared.length; i += 1) {
      const { index, segment, audioPath } = prepared[i];
      const transcript = transcripts[i];

      const remappedWords = remapTimedItems(transcript.words || [], segment.startSec, 'word');
      const remappedUtterances = remapTimedItems(transcript.utterances || [], segment.startSec, 'utterance');
      words.push(...remappedWords);
      utteranceItems.push(...remappedUtterances);

      // Collect audio events (laughter, applause, music, etc.) with remapped timestamps
      for (const event of (transcript.audioEvents || [])) {
        audioEventItems.push({ event: event.event, startSec: Number((segment.startSec + event.startSec).toFixed(3)), endSec: Number((segment.startSec + event.endSec).toFixed(3)) });
      }
      segmentResults.push({
        index, startSec: segment.startSec, endSec: segment.endSec, durationSec: segment.durationSec,
        audioPath, text: String(transcript.text || '').trim(),
        wordCount: remappedWords.length, utteranceCount: remappedUtterances.length,
        languageCode: transcript.languageCode || null,
      });
    }

    const speechDurationSec = Number(segmentResults.reduce((sum, item) => sum + item.durationSec, 0).toFixed(3));
    const skippedSilenceSec = Number(Math.max(0, Number((chunk.endSec - chunk.startSec).toFixed(3)) - speechDurationSec).toFixed(3));
    results.push({
      startSec: chunk.startSec, endSec: chunk.endSec, trimSilenceApplied: trimSilence,
      speechDurationSec, skippedSilenceSec,
      silences: silences.map(s => ({ startSec: Number((chunk.startSec + s.startSec).toFixed(3)), endSec: Number((chunk.startSec + s.endSec).toFixed(3)), durationSec: s.durationSec })),
      segments: segmentResults, text: segmentResults.map(s => s.text).filter(Boolean).join('\n').trim(),
      words, utterances: utteranceItems, audioEvents: audioEventItems,
    });
  }

  const payload = {
    id, provider: providerName, model, chunkSeconds, trimSilence,
    minSilenceSec, padSec, silenceNoiseDb, diarize, utterances,
    smartFormat, punctuate, detectLanguage, language,
    createdAt: new Date().toISOString(), items: results,
  };
  writeArtifactJson(id, 'transcript.json', payload);
  printJson(payload);
}

async function runOcr(positionals, flags, config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', config.ocr.watchpointLimit);
  const manifest = loadManifest(id);
  const providerName = String(flags.provider || config.ocr.provider);
  const provider = createProvider(providerName);
  const model = String(flags.model || config.ocr.model);
  const selected = manifest.watchpoints.slice(0, Math.max(1, Math.floor(limit)));
  const watchpoints = materializeWatchpoints(manifest, selected);
  const ocrPrompt = 'Extract the visible text from this video frame. Return plain text only. Keep line breaks when they help preserve structure. If there is no meaningful visible text, return an empty string.';

  const results = await batchAsync(watchpoints, async (item) => {
    const ocr = await provider.ocrImage({ imagePath: item.framePath, model, prompt: ocrPrompt });
    return { atSec: item.atSec, kind: item.kind, reason: item.reason, framePath: item.framePath, text: ocr.text.trim() };
  }, 5);

  const payload = { id, provider: providerName, model, createdAt: new Date().toISOString(), items: results };
  writeArtifactJson(id, 'ocr.json', payload);
  printJson(payload);
}

async function runEmbed(positionals, flags, config, { requirePositional, parseNumberFlag, parseBooleanFlag, printJson }) {
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
    const withPaths = manifest.watchpoints.map(wp => ({
      ...wp,
      framePath: createArtifactPath(id, 'watchpoints', `watchpoint-${String(wp.atSec.toFixed(3)).replace('.', '_')}.jpg`),
    }));
    if (withPaths.every(wp => fs.existsSync(wp.framePath))) {
      manifest.watchpoints = withPaths;
    } else {
      try {
        manifest.watchpoints = materializeWatchpoints(manifest, manifest.watchpoints.slice());
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

  const srcCounts = { transcript: 0, ocr: 0, frames: 0 };
  for (const i of items) {
    if (i.source === 'transcript') srcCounts.transcript++;
    else if (i.source === 'ocr') srcCounts.ocr++;
    else if (i.source === 'frame') srcCounts.frames++;
  }

  writeArtifactJson(id, 'embeddings.json', {
    id, provider: embedConfig.provider, model: embedConfig.model,
    dimensions, createdAt: new Date().toISOString(), sources: srcCounts, items,
  });
  printJson({
    id, provider: embedConfig.provider, model: embedConfig.model,
    dimensions, totalEmbeddings: items.length, sources: srcCounts,
  });
}

async function runDescribe(positionals, flags, config, { requirePositional, parseNumberFlag, parseBooleanFlag, printJson }) {
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
    frames,
    model,
    prompt: [
      'Describe what you see in this video frame in 2-3 sentences.',
      'Include: any on-screen text, UI elements, diagrams, people, and actions.',
      'Be specific about visual details. If there is text, quote it exactly.',
    ].join(' '),
  });

  writeArtifactJson(id, 'descriptions.json', { id, model, intervalSec, createdAt: new Date().toISOString(), frameCount: descriptions.length, items: descriptions });
  printJson({ id, model, intervalSec, frameCount: descriptions.length, durationSec: manifest.media.durationSec });
}

module.exports = {
  runIngest,
  runTranscribe,
  runOcr,
  runEmbed,
  runDescribe,
};
