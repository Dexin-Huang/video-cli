// search_arch.js — THE EDITABLE FILE
//
// This is the only file the agent modifies during architecture search.
// It defines how embeddings are built and how search results are ranked.
// The eval harness (eval_harness.js) calls these functions and scores the output.
//
// Current baseline: R@1_IoU>=0.5 = 0.24, MRR = 0.29 across 140 queries.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// KNOBS — tweak these to improve retrieval quality
// ============================================================

const KNOBS = {
  // Embedding dimensions (128, 256, 384, 512, 768, 1024, 1536, 3072)
  dimensions: 768,

  // Transcript chunking strategy: 'utterance' | 'sliding_window' | 'segment'
  chunkStrategy: 'utterance',

  // Sliding window params (only used if chunkStrategy === 'sliding_window')
  windowSizeSec: 15,
  windowStepSec: 5,

  // Minimum text length to embed (characters). Filters noise from short utterances.
  minTextLength: 0,

  // Minimum word count to embed. Alternative filter for short utterances.
  minWordCount: 0,

  // Score weighting
  lengthBoostEnabled: false,    // Boost scores for longer text matches
  lengthBoostFactor: 0.1,       // How much to boost per 100 chars of text

  // Lexical/semantic merge weights
  lexicalBaseScore: 0.5,        // Fixed score assigned to lexical (grep) matches
  semanticWeight: 1.0,          // Multiplier on semantic scores during merge
  lexicalWeight: 1.0,           // Multiplier on lexical scores during merge

  // OCR context enrichment
  ocrContextEnabled: false,     // Prepend nearby transcript text to OCR items
  ocrContextWindowSec: 10,      // How many seconds of transcript context to add

  // Frame embedding
  framesEnabled: true,          // Whether to embed watchpoint frame images

  // Deduplication
  dedupeWindowSec: 5,           // Merge results within this time window
};

// ============================================================
// EMBEDDING BUILDER — controls what gets embedded and how
// ============================================================

async function buildSearchEmbeddings({ embedText, embedImage, apiKey, manifest, ocr, transcript }) {
  const model = 'gemini-embedding-2-preview';
  const dims = KNOBS.dimensions;
  const taskType = 'RETRIEVAL_DOCUMENT';
  const items = [];

  // --- Transcript embeddings ---
  if (transcript && Array.isArray(transcript.items)) {
    if (KNOBS.chunkStrategy === 'utterance') {
      items.push(...await embedUtterances({ embedText, apiKey, model, dims, taskType, transcript }));
    } else if (KNOBS.chunkStrategy === 'sliding_window') {
      items.push(...await embedSlidingWindows({ embedText, apiKey, model, dims, taskType, transcript }));
    } else if (KNOBS.chunkStrategy === 'segment') {
      items.push(...await embedSegments({ embedText, apiKey, model, dims, taskType, transcript }));
    }
  }

  // --- OCR embeddings ---
  if (ocr && Array.isArray(ocr.items)) {
    for (let i = 0; i < ocr.items.length; i += 1) {
      let text = String(ocr.items[i].text || '').trim();
      if (!text) continue;

      if (KNOBS.ocrContextEnabled && transcript) {
        const context = getTranscriptContext(transcript, ocr.items[i].atSec, KNOBS.ocrContextWindowSec);
        if (context) {
          text = `[Visual text] ${text}\n[Spoken context] ${context}`;
        }
      }

      if (text.length < KNOBS.minTextLength) continue;

      const vector = await embedText({ apiKey, text, model, taskType, dimensions: dims });
      items.push({
        source: 'ocr',
        index: i,
        atSec: ocr.items[i].atSec,
        framePath: ocr.items[i].framePath || null,
        text,
        vector,
      });
    }
  }

  // --- Frame image embeddings ---
  if (KNOBS.framesEnabled && manifest && Array.isArray(manifest.watchpoints)) {
    for (let i = 0; i < manifest.watchpoints.length; i += 1) {
      const wp = manifest.watchpoints[i];
      if (!wp.framePath || !fs.existsSync(wp.framePath)) continue;

      const vector = await embedImage({ apiKey, imagePath: wp.framePath, model, taskType, dimensions: dims });
      items.push({
        source: 'frame',
        index: i,
        atSec: wp.atSec,
        framePath: wp.framePath,
        vector,
      });
    }
  }

  return items;
}

// ============================================================
// SEARCH RANKER — controls how results are scored and merged
// ============================================================

function rankAndMerge({ queryVec, embeddings, lexicalMatches, topK }) {
  // Score semantic matches
  const semanticScored = embeddings.map(item => {
    let score = cosineSimilarity(queryVec, item.vector);

    // Length boost: reward longer text matches
    if (KNOBS.lengthBoostEnabled && item.text) {
      score += (item.text.length / 100) * KNOBS.lengthBoostFactor;
    }

    score *= KNOBS.semanticWeight;

    return {
      score: Number(score.toFixed(6)),
      source: item.source,
      index: item.index,
      atSec: item.atSec ?? null,
      startSec: item.startSec ?? null,
      endSec: item.endSec ?? null,
      speaker: item.speaker ?? null,
      framePath: item.framePath ?? null,
      text: item.text ?? null,
    };
  });

  // Score lexical matches
  const lexicalScored = (lexicalMatches || []).map(item => ({
    score: Number((KNOBS.lexicalBaseScore * KNOBS.lexicalWeight).toFixed(6)),
    source: item.source,
    atSec: item.atSec ?? null,
    startSec: item.startSec ?? null,
    endSec: item.endSec ?? null,
    speaker: item.speaker ?? null,
    framePath: item.framePath ?? null,
    text: item.text ?? null,
  }));

  // Merge and deduplicate
  const byKey = new Map();
  for (const item of [...semanticScored, ...lexicalScored]) {
    const at = item.atSec ?? item.startSec ?? 0;
    const key = `${item.source}:${at}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }

  // Dedupe within time window
  let results = Array.from(byKey.values()).sort((a, b) => b.score - a.score);
  if (KNOBS.dedupeWindowSec > 0) {
    results = dedupeByTime(results, KNOBS.dedupeWindowSec);
  }

  return results.slice(0, topK);
}

// ============================================================
// HELPERS
// ============================================================

async function embedUtterances({ embedText, apiKey, model, dims, taskType, transcript }) {
  const items = [];
  let index = 0;
  for (const chunk of transcript.items) {
    for (const utt of (chunk.utterances || [])) {
      const text = String(utt.transcript || '').trim();
      if (!text) continue;
      if (text.length < KNOBS.minTextLength) continue;
      if (text.split(/\s+/).length < KNOBS.minWordCount) continue;

      const vector = await embedText({ apiKey, text, model, taskType, dimensions: dims });
      items.push({
        source: 'transcript', index, startSec: utt.startSec, endSec: utt.endSec,
        speaker: utt.speaker ?? null, text, vector,
      });
      index += 1;
    }
  }
  return items;
}

async function embedSlidingWindows({ embedText, apiKey, model, dims, taskType, transcript }) {
  const items = [];
  // Collect all words with timestamps
  const allWords = [];
  for (const chunk of transcript.items) {
    for (const word of (chunk.words || [])) {
      allWords.push(word);
    }
  }
  if (allWords.length === 0) return items;

  const maxTime = allWords[allWords.length - 1].endSec || 0;
  let index = 0;

  for (let windowStart = 0; windowStart < maxTime; windowStart += KNOBS.windowStepSec) {
    const windowEnd = windowStart + KNOBS.windowSizeSec;
    const windowWords = allWords.filter(w => w.startSec >= windowStart && w.startSec < windowEnd);
    const text = windowWords.map(w => w.punctuatedWord || w.word).join(' ').trim();
    if (!text || text.length < KNOBS.minTextLength) continue;

    const vector = await embedText({ apiKey, text, model, taskType, dimensions: dims });
    items.push({
      source: 'transcript', index, startSec: windowStart, endSec: windowEnd,
      text, vector,
    });
    index += 1;
  }
  return items;
}

async function embedSegments({ embedText, apiKey, model, dims, taskType, transcript }) {
  const items = [];
  let index = 0;
  for (const chunk of transcript.items) {
    for (const seg of (chunk.segments || [])) {
      const text = String(seg.text || '').trim();
      if (!text || text.length < KNOBS.minTextLength) continue;

      const vector = await embedText({ apiKey, text, model, taskType, dimensions: dims });
      items.push({
        source: 'transcript', index, startSec: seg.startSec, endSec: seg.endSec,
        text, vector,
      });
      index += 1;
    }
  }
  return items;
}

function getTranscriptContext(transcript, atSec, windowSec) {
  const texts = [];
  for (const chunk of transcript.items) {
    for (const utt of (chunk.utterances || [])) {
      if (Math.abs(utt.startSec - atSec) <= windowSec) {
        texts.push(utt.transcript);
      }
    }
  }
  return texts.join(' ').trim();
}

function dedupeByTime(results, windowSec) {
  const kept = [];
  for (const item of results) {
    const at = item.atSec ?? item.startSec ?? 0;
    const isDupe = kept.some(k => {
      const kAt = k.atSec ?? k.startSec ?? 0;
      return Math.abs(at - kAt) < windowSec && item.source === k.source;
    });
    if (!isDupe) kept.push(item);
  }
  return kept;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = { KNOBS, buildSearchEmbeddings, rankAndMerge };
