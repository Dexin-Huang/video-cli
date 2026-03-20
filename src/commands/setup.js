const path = require('node:path');

const { loadManifest, saveManifest } = require('../lib/store');
const { buildVideoId, getFileIdentity, materializeWatchpoints, probeVideo } = require('../lib/media');
const { readArtifactJson, writeArtifactJson } = require('../lib/artifacts');
const { analyzeFrames } = require('../lib/describe');
const { runIngest, runTranscribe, runEmbed } = require('./pipeline');

async function runSetup(positionals, flags, config, helpers) {
  const { requirePositional, printJson } = helpers;
  const inputFile = requirePositional(positionals, 0, '<file>');

  // Cost estimate based on probe duration (reuses probe from ingest)
  const resolvedInput = path.resolve(inputFile);
  const probeResult = probeVideo(resolvedInput);
  const estDuration = Number(probeResult.format.duration || 0);
  const estMinutes = estDuration / 60;
  const estTranscribe = estMinutes * 0.004;
  const estAnalyze = 0.003;
  const estEmbed = 0.001;
  const estTotal = estTranscribe + estAnalyze + estEmbed;
  console.error(
    `setup: estimated cost ~$${estTotal.toFixed(4)} ` +
    `(transcribe ~$${estTranscribe.toFixed(4)}, analyze ~$${estAnalyze.toFixed(4)}, embed ~$${estEmbed.toFixed(4)})`
  );

  // Compute ID early and save a minimal manifest so transcribe can read sourcePath
  const identity = getFileIdentity(resolvedInput);
  const id = buildVideoId(identity);
  const durationSec = Number(probeResult.format.duration || 0);

  saveManifest({
    id,
    importedAt: new Date().toISOString(),
    sourcePath: resolvedInput,
    sourceName: path.basename(resolvedInput),
    file: identity,
    media: { durationSec, audio: probeResult.streams?.find(s => s.codec_type === 'audio') ? {} : null },
    sceneDetection: { changePointsSec: [] },
    watchpoints: [],
  });

  // Step 1+2: Ingest (scene detection) and Transcribe (audio) in parallel
  // Both need the source file but for different tracks. Ingest overwrites the manifest.
  console.error('setup: ingesting + transcribing in parallel...');
  await Promise.all([
    (async () => {
      await runIngest(positionals, flags, helpers);
      const manifest = loadManifest(id);
      console.error('setup: ingested ' + id + ' (' + manifest.watchpoints.length + ' watchpoints)');
    })(),
    runTranscribe([id], { 'trim-silence': true }, config, helpers),
  ]);

  // Step 3: Analyze (needs watchpoint frames from ingest)
  console.error('setup: analyzing frames...');
  await runAnalyze([id], {}, config, helpers);

  // Step 4: Embed (needs transcript + OCR from above)
  console.error('setup: embedding...');
  await runEmbed([id], {}, config, helpers);

  const finalManifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');
  const embeddings = readArtifactJson(id, 'embeddings.json');

  printJson({
    id,
    sourceName: finalManifest.sourceName,
    durationSec: finalManifest.media.durationSec,
    watchpoints: finalManifest.watchpoints.length,
    utterances: transcript ? transcript.items.reduce((s, i) => s + (i.utterances || []).length, 0) : 0,
    ocrItems: ocr ? ocr.items.length : 0,
    descriptions: descriptions ? descriptions.items.length : 0,
    embeddings: embeddings ? embeddings.items.length : 0,
    ready: true,
  });
}

async function runAnalyze(positionals, flags, config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const model = String(flags.model || config.ocr.model);
  const apiKey = process.env.GEMINI_API_KEY || null;
  const limit = parseNumberFlag(flags, 'limit', config.ocr.watchpointLimit);
  const selected = manifest.watchpoints.slice(0, Math.max(1, Math.floor(limit)));
  const frames = materializeWatchpoints(manifest, selected);

  const results = await analyzeFrames({ apiKey, frames, model });

  const now = new Date().toISOString();

  const ocrItems = results.map(r => ({
    atSec: r.atSec,
    framePath: r.framePath,
    text: r.text,
  }));
  const ocrPayload = {
    id,
    provider: 'gemini',
    model,
    createdAt: now,
    items: ocrItems,
  };
  writeArtifactJson(id, 'ocr.json', ocrPayload);

  const descItems = results.map(r => ({
    atSec: r.atSec,
    framePath: r.framePath,
    description: r.description,
  }));
  const descPayload = {
    id,
    model,
    createdAt: now,
    frameCount: descItems.length,
    items: descItems,
  };
  writeArtifactJson(id, 'descriptions.json', descPayload);

  printJson({
    id,
    model,
    frameCount: results.length,
    ocrItems: ocrItems.filter(i => i.text).length,
    descriptions: descItems.length,
  });
}

module.exports = { runSetup, runAnalyze };
