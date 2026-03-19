// research/lib.js — IMMUTABLE UTILITY LIBRARY
//
// DO NOT EDIT during architecture search.
// Import from search_arch.js: const lib = require('./lib.js');
//
// Provides rate-limited, cost-tracked API calls and common utilities.
// Max 1 Gemini call per query. Flash-Lite only. Cost is tracked and
// reported to the eval harness.

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
require(path.join(repoRoot, 'src', 'lib', 'env.js')).loadEnvFile(repoRoot);

const FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview';
const FLASH_LITE_INPUT_PER_MTOK = 0.10;
const FLASH_LITE_OUTPUT_PER_MTOK = 0.40;
const EMBED_MODEL = 'gemini-embedding-2-preview';
const EMBED_PER_MTOK = 0.20;

// ============================================================
// COST TRACKER — accumulates across calls, reset per eval run
// ============================================================

let _totalCostUsd = 0;
let _callCount = 0;
const COST_BUDGET_PER_QUERY = 0.005; // $0.005 max per query — hard cap
let _costThisQuery = 0;

function resetCostTracker() {
  _totalCostUsd = 0;
  _callCount = 0;
}

function resetQueryCallCount() {
  _costThisQuery = 0;
}

function getCostStats() {
  return {
    totalCostUsd: Number(_totalCostUsd.toFixed(6)),
    callCount: _callCount,
  };
}

function _addCost(inputTokens, outputTokens) {
  const cost = (inputTokens / 1e6) * FLASH_LITE_INPUT_PER_MTOK
    + (outputTokens / 1e6) * FLASH_LITE_OUTPUT_PER_MTOK;
  _costThisQuery += cost;
  _totalCostUsd += cost;
  _callCount += 1;
}

function _checkBudget() {
  if (_costThisQuery >= COST_BUDGET_PER_QUERY) {
    throw new Error(`lib.js: query cost budget exceeded ($${_costThisQuery.toFixed(4)} >= $${COST_BUDGET_PER_QUERY})`);
  }
}

// ============================================================
// GEMINI FLASH-LITE: single-turn text completion
// ============================================================

async function askFlashLite(prompt, options = {}) {
  _checkBudget();

  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return { text: 'mock response', inputTokens: 100, outputTokens: 50 };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('lib.js: GEMINI_API_KEY not set');

  const maxTokens = options.maxTokens || 200;
  const temperature = options.temperature ?? 0.0;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(FLASH_LITE_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.error?.message || JSON.stringify(payload);
    throw new Error(`lib.js: Gemini Flash-Lite failed: ${msg}`);
  }

  const candidates = payload.candidates || [];
  const text = (candidates[0]?.content?.parts || [])
    .map(p => typeof p.text === 'string' ? p.text : '')
    .join('')
    .trim();

  const usage = payload.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || Math.ceil(prompt.length / 4);
  const outputTokens = usage.candidatesTokenCount || Math.ceil(text.length / 4);
  _addCost(inputTokens, outputTokens);

  return { text, inputTokens, outputTokens };
}

// ============================================================
// CONVENIENCE: classify query type
// ============================================================

async function classifyQuery(query) {
  const result = await askFlashLite(
    `Classify this video search query into exactly one category.\n\nQuery: "${query}"\n\nCategories:\n- transcript (about what was said/spoken)\n- visual (about what is shown/seen on screen)\n- ocr (about on-screen text, labels, numbers)\n- temporal (about ordering/sequence of events)\n- cross_modal (needs both visual and audio/text)\n\nReturn ONLY the category name, nothing else.`,
    { maxTokens: 10, temperature: 0.0 }
  );
  const category = result.text.trim().toLowerCase().replace(/[^a-z_]/g, '');
  const valid = ['transcript', 'visual', 'ocr', 'temporal', 'cross_modal'];
  return valid.includes(category) ? category : 'transcript';
}

// ============================================================
// CONVENIENCE: expand/rephrase a query
// ============================================================

async function expandQuery(query) {
  const result = await askFlashLite(
    `You are a search query expander for a video search system. Given a query, return an expanded version that includes synonyms, related terms, and alternative phrasings that would help find the relevant video moment.\n\nQuery: "${query}"\n\nReturn ONLY the expanded query text (one line, no explanation).`,
    { maxTokens: 80, temperature: 0.0 }
  );
  return result.text.trim();
}

// ============================================================
// CONVENIENCE: rerank results
// ============================================================

async function rerankResults(query, results) {
  if (!results || results.length === 0) return results;

  const candidates = results.slice(0, 10).map((r, i) => {
    const at = r.startSec ?? r.atSec ?? 0;
    const text = r.text ? r.text.slice(0, 150) : '(frame)';
    return `[${i}] @${at}s (${r.source}): ${text}`;
  }).join('\n');

  const result = await askFlashLite(
    `You are a video search result ranker. Given a query and candidate results, return the indices of the top 5 most relevant results in order of relevance.\n\nQuery: "${query}"\n\nCandidates:\n${candidates}\n\nReturn ONLY a comma-separated list of indices (e.g., "3,0,7,1,4"), nothing else.`,
    { maxTokens: 30, temperature: 0.0 }
  );

  const indices = result.text.trim().split(/[,\s]+/).map(Number).filter(i => Number.isFinite(i) && i >= 0 && i < results.length);
  const seen = new Set();
  const reranked = [];
  for (const i of indices) {
    if (!seen.has(i)) { seen.add(i); reranked.push(results[i]); }
  }
  // Append any results not mentioned
  for (let i = 0; i < results.length && reranked.length < results.length; i++) {
    if (!seen.has(i)) reranked.push(results[i]);
  }
  return reranked;
}

// ============================================================
// DATA LOADERS — load raw artifacts for a video
// ============================================================

function loadManifest(videoId) {
  const p = path.join(repoRoot, 'data', 'videos', videoId, 'manifest.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadTranscript(videoId) {
  const p = path.join(repoRoot, 'data', 'videos', videoId, 'transcript.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadOcr(videoId) {
  const p = path.join(repoRoot, 'data', 'videos', videoId, 'ocr.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadDescriptions(videoId) {
  const p = path.join(repoRoot, 'data', 'videos', videoId, 'descriptions.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadEmbeddings(videoId) {
  const p = path.join(repoRoot, 'data', 'videos', videoId, 'embeddings.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// ============================================================
// VECTOR MATH
// ============================================================

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ma += a[i] * a[i]; mb += b[i] * b[i]; }
  const d = Math.sqrt(ma * mb);
  return d ? dot / d : 0;
}

function zNormalizeScores(items) {
  const bySource = {};
  for (const item of items) (bySource[item.source] ??= []).push(item);
  for (const group of Object.values(bySource)) {
    const scores = group.map(i => i.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) || 1;
    for (const item of group) item.score = (item.score - mean) / std;
  }
  return items;
}

// ============================================================
// WORD-LEVEL UTILITIES
// ============================================================

function getWordsInRange(transcript, startSec, endSec) {
  const words = [];
  if (!transcript || !Array.isArray(transcript.items)) return words;
  for (const chunk of transcript.items) {
    for (const w of (chunk.words || [])) {
      if (w.startSec >= startSec && w.startSec < endSec) {
        words.push(w);
      }
    }
  }
  return words;
}

function getUtterancesInRange(transcript, startSec, endSec) {
  const utts = [];
  if (!transcript || !Array.isArray(transcript.items)) return utts;
  for (const chunk of transcript.items) {
    for (const u of (chunk.utterances || [])) {
      if (u.endSec > startSec && u.startSec < endSec) utts.push(u);
    }
  }
  return utts;
}

function getSceneChangesNear(manifest, atSec, windowSec) {
  if (!manifest?.sceneDetection?.changePointsSec) return [];
  return manifest.sceneDetection.changePointsSec.filter(t => Math.abs(t - atSec) <= windowSec);
}

function snapToSceneBoundary(manifest, sec) {
  if (!manifest?.sceneDetection?.changePointsSec) return sec;
  const points = manifest.sceneDetection.changePointsSec;
  let best = sec;
  let bestDist = Infinity;
  for (const p of points) {
    const dist = Math.abs(p - sec);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  return bestDist < 5 ? best : sec;
}

module.exports = {
  // API calls (max 1 per query)
  askFlashLite,
  classifyQuery,
  expandQuery,
  rerankResults,

  // Cost tracking
  resetCostTracker,
  resetQueryCallCount,
  getCostStats,

  // Data loaders
  loadManifest,
  loadTranscript,
  loadOcr,
  loadDescriptions,
  loadEmbeddings,

  // Vector math
  cosine,
  zNormalizeScores,

  // Word/scene utilities
  getWordsInRange,
  getUtterancesInRange,
  getSceneChangesNear,
  snapToSceneBoundary,

  // Constants
  FLASH_LITE_MODEL,
  EMBED_MODEL,
  COST_BUDGET_PER_QUERY,
};
