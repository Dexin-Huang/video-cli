const crypto = require('node:crypto');
const fs = require('node:fs');
const { batchAsync, fetchWithRetry, guessMimeType } = require('./net');

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
    const { extractGeminiError } = require('./net');
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

  // Collect transcript items to embed
  const transcriptPending = [];
  if (sources.transcript && transcript && Array.isArray(transcript.items)) {
    let index = 0;
    for (const chunk of transcript.items) {
      const utterances = Array.isArray(chunk.utterances) ? chunk.utterances : [];
      for (const utterance of utterances) {
        const text = String(utterance.transcript || '').trim();
        if (!text) {
          continue;
        }
        transcriptPending.push({ index, utterance, text });
        index += 1;
      }
    }
  }

  if (transcriptPending.length > 0) {
    const vectors = await batchAsync(transcriptPending, (item) =>
      embedText({ apiKey, text: item.text, model, taskType, dimensions }), 15, 'embedding');
    for (let i = 0; i < transcriptPending.length; i += 1) {
      const item = transcriptPending[i];
      items.push({
        source: 'transcript',
        index: item.index,
        startSec: item.utterance.startSec,
        endSec: item.utterance.endSec,
        speaker: item.utterance.speaker ?? null,
        text: item.text,
        vector: vectors[i],
      });
    }
  }

  // Collect OCR items to embed
  const ocrPending = [];
  if (sources.ocr && ocr && Array.isArray(ocr.items)) {
    for (let i = 0; i < ocr.items.length; i += 1) {
      const ocrItem = ocr.items[i];
      const text = String(ocrItem.text || '').trim();
      if (!text) {
        continue;
      }
      ocrPending.push({ index: i, ocrItem, text });
    }
  }

  if (ocrPending.length > 0) {
    const vectors = await batchAsync(ocrPending, (item) =>
      embedText({ apiKey, text: item.text, model, taskType, dimensions }), 15, 'embedding');
    for (let i = 0; i < ocrPending.length; i += 1) {
      const item = ocrPending[i];
      items.push({
        source: 'ocr',
        index: item.index,
        atSec: item.ocrItem.atSec,
        framePath: item.ocrItem.framePath || null,
        text: item.text,
        vector: vectors[i],
      });
    }
  }

  // Collect frame items to embed
  const framePending = [];
  if (sources.frames && manifest && Array.isArray(manifest.watchpoints)) {
    for (let i = 0; i < manifest.watchpoints.length; i += 1) {
      const wp = manifest.watchpoints[i];
      const framePath = wp.framePath;
      if (!framePath || !fs.existsSync(framePath)) {
        continue;
      }
      framePending.push({ index: i, wp, framePath });
    }
  }

  if (framePending.length > 0) {
    const vectors = await batchAsync(framePending, (item) =>
      embedImage({ apiKey, imagePath: item.framePath, model, taskType, dimensions }), 5, 'embedding');
    for (let i = 0; i < framePending.length; i += 1) {
      const item = framePending[i];
      items.push({
        source: 'frame',
        index: item.index,
        atSec: item.wp.atSec,
        framePath: item.framePath,
        vector: vectors[i],
      });
    }
  }

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
