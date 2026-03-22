const crypto = require('node:crypto');
const fs = require('node:fs');
const { batchAsync, fetchWithRetry, extractGeminiError, guessMimeType } = require('./net');
const { collectTranscriptEntries } = require('./transcript');

const DEFAULT_MODEL = 'gemini-embedding-2-preview';
const DEFAULT_DIMENSIONS = 768;

async function embedText({ apiKey, text, model, taskType, dimensions }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return mockVector(text, dimensions || DEFAULT_DIMENSIONS);
  }

  return callEmbedApi({
    apiKey,
    model: model || DEFAULT_MODEL,
    dimensions: dimensions || DEFAULT_DIMENSIONS,
    taskType: taskType || 'RETRIEVAL_DOCUMENT',
    content: { parts: [{ text }] },
  });
}

async function embedImage({ apiKey, imagePath, model, taskType, dimensions }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return mockVector(imagePath, dimensions || DEFAULT_DIMENSIONS);
  }

  const data = fs.readFileSync(imagePath).toString('base64');
  const mimeType = guessMimeType(imagePath);

  return callEmbedApi({
    apiKey,
    model: model || DEFAULT_MODEL,
    dimensions: dimensions || DEFAULT_DIMENSIONS,
    taskType: taskType || 'RETRIEVAL_DOCUMENT',
    content: { parts: [{ inlineData: { mimeType, data } }] },
  });
}

async function callEmbedApi({ apiKey, model, dimensions, taskType, content }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, taskType, outputDimensionality: dimensions }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini embedding request failed: ${extractGeminiError(payload)}`);
  }

  const values = payload?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error('Gemini embedding response missing embedding.values');
  }
  return values;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) {
    return 0;
  }

  return dot / denom;
}

function rankBySimilarity(queryVec, items, topK) {
  const scored = items.map(item => ({
    score: Number(cosineSimilarity(queryVec, item.vector).toFixed(6)),
    source: item.source,
    index: item.index,
    atSec: item.atSec ?? null,
    startSec: item.startSec ?? null,
    endSec: item.endSec ?? null,
    speaker: item.speaker ?? null,
    framePath: item.framePath ?? null,
    text: item.text ?? null,
  }));

  scored.sort((a, b) => b.score - a.score);

  const limit = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : scored.length;
  return scored.slice(0, limit);
}

async function buildEmbeddings({ apiKey, manifest, ocr, transcript, config }) {
  const model = config.model || DEFAULT_MODEL;
  const dimensions = config.dimensions || DEFAULT_DIMENSIONS;
  const taskType = config.taskTypeDocument || 'RETRIEVAL_DOCUMENT';
  const sources = config.sources || { transcript: true, ocr: true, frames: true };
  const items = [];

  const embedBatch = async (pending, embedFn, mapFn, concurrency = 15) => {
    if (pending.length === 0) return;
    const vectors = await batchAsync(pending, embedFn, concurrency, 'embedding');
    for (let i = 0; i < pending.length; i++) items.push({ ...mapFn(pending[i]), vector: vectors[i] });
  };

  const transcriptPending = [];
  if (sources.transcript && transcript && Array.isArray(transcript.items)) {
    const entries = collectTranscriptEntries(transcript);
    for (let index = 0; index < entries.length; index += 1) {
      transcriptPending.push({ index, entry: entries[index], text: entries[index].text });
    }
  }
  await embedBatch(transcriptPending,
    item => embedText({ apiKey, text: item.text, model, taskType, dimensions }),
    item => ({
      source: 'transcript',
      index: item.index,
      startSec: item.entry.startSec,
      endSec: item.entry.endSec,
      speaker: item.entry.speaker ?? null,
      text: item.text,
    }));

  const ocrPending = [];
  if (sources.ocr && ocr && Array.isArray(ocr.items)) {
    for (let i = 0; i < ocr.items.length; i++) {
      const text = String(ocr.items[i].text || '').trim();
      if (text) ocrPending.push({ index: i, item: ocr.items[i], text });
    }
  }
  await embedBatch(ocrPending,
    item => embedText({ apiKey, text: item.text, model, taskType, dimensions }),
    item => ({ source: 'ocr', index: item.index, atSec: item.item.atSec, framePath: item.item.framePath || null, text: item.text }));

  const framePending = [];
  if (sources.frames && manifest && Array.isArray(manifest.watchpoints)) {
    for (let i = 0; i < manifest.watchpoints.length; i++) {
      const wp = manifest.watchpoints[i];
      if (wp.framePath && fs.existsSync(wp.framePath)) framePending.push({ index: i, wp });
    }
  }
  await embedBatch(framePending,
    item => embedImage({ apiKey, imagePath: item.wp.framePath, model, taskType, dimensions }),
    item => ({ source: 'frame', index: item.index, atSec: item.wp.atSec, framePath: item.wp.framePath }), 5);

  return items;
}

function mockVector(seed, dimensions) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  const vector = new Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) {
    const byte1 = hash[(i * 2) % hash.length];
    const byte2 = hash[(i * 2 + 1) % hash.length];
    vector[i] = ((byte1 * 256 + byte2) / 65535) * 2 - 1;
  }

  let mag = 0;
  for (let i = 0; i < dimensions; i += 1) {
    mag += vector[i] * vector[i];
  }
  mag = Math.sqrt(mag);

  if (mag > 0) {
    for (let i = 0; i < dimensions; i += 1) {
      vector[i] = Number((vector[i] / mag).toFixed(6));
    }
  }

  return vector;
}

module.exports = {
  buildEmbeddings,
  cosineSimilarity,
  embedText,
  rankBySimilarity,
};
