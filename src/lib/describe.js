const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { createArtifactPath } = require('./store');
const { writeArtifactJson } = require('./artifacts');
const { batchAsync, fetchWithRetry, extractGeminiText, extractGeminiError, guessMimeType } = require('./net');

async function analyzeFrames({ apiKey, frames, model }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return frames.map(frame => ({
      atSec: frame.atSec,
      framePath: frame.framePath,
      text: `mock ocr for frame at ${frame.atSec}s`,
      description: `mock description for frame at ${frame.atSec}s`,
    }));
  }

  const prompt = [
    'Analyze this video frame. Return a JSON object with two fields:',
    "1. 'text': Extract all visible text exactly as shown (labels, titles, subtitles, numbers). Return empty string if no text.",
    "2. 'description': Describe what you see in 2-3 sentences (people, actions, UI elements, diagrams).",
  ].join('\n');

  return batchAsync(frames, async (frame) => {
    const raw = await callGeminiDescribe({ apiKey, model, prompt, imagePath: frame.framePath });
    let text = '';
    let description = raw.trim();
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        text = typeof parsed.text === 'string' ? parsed.text : '';
        description = typeof parsed.description === 'string' ? parsed.description : description;
      }
    } catch (_) {}
    return { atSec: frame.atSec, framePath: frame.framePath, text, description };
  }, 5, 'analyzing');
}

async function describeFrames({ apiKey, frames, model, prompt }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return frames.map(frame => ({
      atSec: frame.atSec,
      framePath: frame.framePath,
      description: `mock description for frame at ${frame.atSec}s`,
    }));
  }

  return batchAsync(frames, async (frame) => ({
    atSec: frame.atSec,
    framePath: frame.framePath,
    description: (await callGeminiDescribe({ apiKey, model, prompt, imagePath: frame.framePath })).trim(),
  }), 5);
}

async function callGeminiDescribe({ apiKey, model, prompt, imagePath }) {
  const data = fs.readFileSync(imagePath).toString('base64');
  const mimeType = guessMimeType(imagePath);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType, data } }, { text: prompt }] }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini describe failed: ${extractGeminiError(payload)}`);
  }
  return extractGeminiText(payload);
}

function extractSingleFrame(sourcePath, atSec, videoId) {
  const framePath = createArtifactPath(videoId, 'dense-frames', `dense-${String(atSec.toFixed(3)).replace('.', '_')}.jpg`);
  if (!fs.existsSync(framePath)) {
    const result = spawnSync('ffmpeg', ['-y', '-ss', String(atSec), '-i', sourcePath, '-frames:v', '1', '-q:v', '3', framePath], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 && result.status !== null) return null;
  }
  return fs.existsSync(framePath) ? { atSec, framePath } : null;
}

function extractDenseFrames(sourcePath, durationSec, intervalSec, videoId) {
  const frames = [];
  for (let t = 0; t < durationSec; t += intervalSec) {
    const f = extractSingleFrame(sourcePath, Number(t.toFixed(3)), videoId);
    if (f) frames.push(f);
  }
  return frames;
}

async function enrichRegion({ apiKey, model, sourcePath, videoId, startSec, endSec, intervalSec, existingDescriptions }) {
  const existing = new Set();
  if (existingDescriptions?.items) {
    for (const d of existingDescriptions.items) existing.add(d.atSec.toFixed(3));
  }
  const frames = [];
  for (let t = startSec; t <= endSec; t += (intervalSec || 2)) {
    const atSec = Number(t.toFixed(3));
    if (existing.has(atSec.toFixed(3))) continue;
    const f = extractSingleFrame(sourcePath, atSec, videoId);
    if (f) frames.push(f);
  }
  if (frames.length === 0) return [];
  return describeFrames({ apiKey, frames, model, prompt: 'Describe what you see in this video frame in 2-3 sentences. Include: any on-screen text, UI elements, diagrams, people, and actions. Be specific about visual details. If there is text, quote it exactly.' });
}

async function generateEvalQueries({ apiKey, model, descriptions, transcript }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return [{ query: 'mock eval query', groundTruthSpans: [{ startSec: 0, endSec: 10 }], modality: 'transcript', difficulty: 'exact' }];
  }

  const timelineEntries = descriptions.map(d => `[${d.atSec}s] ${d.description}`).join('\n');
  const transcriptText = transcript?.items
    ? transcript.items.map(chunk => (chunk.utterances || []).map(u => `[${u.startSec}-${u.endSec}s] ${u.transcript}`).join('\n')).filter(Boolean).join('\n')
    : '';

  const prompt = `You are generating evaluation queries for a video search system.

Below is a dense visual timeline (frame descriptions every 2 seconds) and a transcript with timestamps.

VISUAL TIMELINE:
${timelineEntries}

TRANSCRIPT:
${transcriptText}

Generate 20 diverse search queries that a user might ask about this video. For each query, provide the ground truth time span(s) where the answer is found.

Requirements:
- Mix of query types: exact phrase (in transcript), paraphrase, visual-only, cross-modal (needs both visual + transcript), temporal (before/after)
- Each query should have a clear correct answer with specific timestamps
- Ground truth spans should be tight (not the whole video)
- Include queries at different difficulty levels

Return valid JSON array:
[
  {
    "query": "the search query text",
    "groundTruthSpans": [{"startSec": N, "endSec": N}],
    "modality": "transcript|visual|ocr|cross_modal",
    "difficulty": "exact|semantic|cross_modal|temporal"
  }
]

Return ONLY the JSON array, no other text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini eval generation failed: ${extractGeminiError(payload)}`);
  }

  const text = extractGeminiText(payload);
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse eval queries from Gemini response');
  }
  return JSON.parse(jsonMatch[0]);
}

async function jitEnrich({ id, manifest, descriptions, startSec, endSec, model }) {
  if (!manifest.sourcePath || !fs.existsSync(manifest.sourcePath)) return descriptions;

  const hasCoverage = descriptions && Array.isArray(descriptions.items) &&
    descriptions.items.some(d => d.atSec >= startSec && d.atSec <= endSec);
  if (hasCoverage) return descriptions;

  const apiKey = process.env.GEMINI_API_KEY || null;
  const descModel = model || 'gemini-3.1-flash-lite-preview';

  const newItems = await enrichRegion({
    apiKey, model: descModel,
    sourcePath: manifest.sourcePath, videoId: id,
    startSec, endSec, intervalSec: 2,
    existingDescriptions: descriptions,
  });

  if (newItems.length > 0) {
    if (!descriptions) {
      descriptions = { id, model: descModel, intervalSec: 2, createdAt: new Date().toISOString(), frameCount: 0, items: [] };
    }
    descriptions.items.push(...newItems);
    descriptions.items.sort((a, b) => a.atSec - b.atSec);
    descriptions.frameCount = descriptions.items.length;
    writeArtifactJson(id, 'descriptions.json', descriptions);
  }

  return descriptions;
}

module.exports = {
  analyzeFrames,
  describeFrames,
  enrichRegion,
  extractDenseFrames,
  generateEvalQueries,
  jitEnrich,
};
