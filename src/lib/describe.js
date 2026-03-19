const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createArtifactPath } = require('./store');

async function describeFrames({ apiKey, manifest, frames, model, prompt }) {
  const results = [];

  for (const frame of frames) {
    if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
      results.push({
        atSec: frame.atSec,
        framePath: frame.framePath,
        description: `mock description for frame at ${frame.atSec}s`,
      });
      continue;
    }

    const description = await callGeminiDescribe({
      apiKey,
      model,
      prompt,
      imagePath: frame.framePath,
    });

    results.push({
      atSec: frame.atSec,
      framePath: frame.framePath,
      description: description.trim(),
    });
  }

  return results;
}

async function callGeminiDescribe({ apiKey, model, prompt, imagePath }) {
  const data = fs.readFileSync(imagePath).toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data } },
            { text: prompt },
          ],
        }],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || JSON.stringify(payload);
      throw new Error(`Gemini describe failed: ${message}`);
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const parts = candidates[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return '';
    }
    return parts.map(p => typeof p.text === 'string' ? p.text : '').join('\n').trim();
  } finally {
    clearTimeout(timeout);
  }
}

function extractDenseFrames(sourcePath, durationSec, intervalSec, videoId) {
  const frames = [];
  for (let t = 0; t < durationSec; t += intervalSec) {
    const atSec = Number(t.toFixed(3));
    const fileName = `dense-${String(atSec.toFixed(3)).replace('.', '_')}.jpg`;
    const framePath = createArtifactPath(videoId, 'dense-frames', fileName);

    if (!fs.existsSync(framePath)) {
      const result = spawnSync('ffmpeg', [
        '-y', '-ss', String(atSec), '-i', sourcePath,
        '-frames:v', '1', '-q:v', '3', framePath,
      ], { encoding: 'utf8', windowsHide: true });

      if (result.status !== 0 && result.status !== null) {
        continue;
      }
    }

    if (fs.existsSync(framePath)) {
      frames.push({ atSec, framePath });
    }
  }
  return frames;
}

async function enrichRegion({ apiKey, model, sourcePath, videoId, startSec, endSec, intervalSec, existingDescriptions }) {
  const existing = new Set();
  if (existingDescriptions && Array.isArray(existingDescriptions.items)) {
    for (const d of existingDescriptions.items) existing.add(d.atSec.toFixed(3));
  }

  const interval = intervalSec || 2;
  const frames = [];
  for (let t = startSec; t <= endSec; t += interval) {
    const atSec = Number(t.toFixed(3));
    if (existing.has(atSec.toFixed(3))) continue;

    const fileName = `dense-${String(atSec.toFixed(3)).replace('.', '_')}.jpg`;
    const framePath = createArtifactPath(videoId, 'dense-frames', fileName);

    if (!fs.existsSync(framePath)) {
      const result = spawnSync('ffmpeg', [
        '-y', '-ss', String(atSec), '-i', sourcePath,
        '-frames:v', '1', '-q:v', '3', framePath,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0 && result.status !== null) continue;
    }
    if (fs.existsSync(framePath)) frames.push({ atSec, framePath });
  }

  if (frames.length === 0) return [];

  const prompt = [
    'Describe what you see in this video frame in 2-3 sentences.',
    'Include: any on-screen text, UI elements, diagrams, people, and actions.',
    'Be specific about visual details. If there is text, quote it exactly.',
  ].join(' ');

  const described = await describeFrames({ apiKey, manifest: null, frames, model, prompt });
  return described;
}

async function generateEvalQueries({ apiKey, model, descriptions, transcript }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return [
      {
        query: 'mock eval query',
        groundTruthSpans: [{ startSec: 0, endSec: 10 }],
        modality: 'transcript',
        difficulty: 'exact',
      },
    ];
  }

  const timelineEntries = descriptions.map(d =>
    `[${d.atSec}s] ${d.description}`
  ).join('\n');

  const transcriptText = transcript && Array.isArray(transcript.items)
    ? transcript.items.map(chunk => {
      const utts = (chunk.utterances || []).map(u =>
        `[${u.startSec}-${u.endSec}s] ${u.transcript}`
      ).join('\n');
      return utts;
    }).filter(Boolean).join('\n')
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || JSON.stringify(payload);
      throw new Error(`Gemini eval generation failed: ${message}`);
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const text = (candidates[0]?.content?.parts || [])
      .map(p => typeof p.text === 'string' ? p.text : '')
      .join('')
      .trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse eval queries from Gemini response');
    }

    return JSON.parse(jsonMatch[0]);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  describeFrames,
  enrichRegion,
  extractDenseFrames,
  generateEvalQueries,
};
