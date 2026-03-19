const fs = require('node:fs');
const path = require('node:path');

async function askQuestion({ apiKey, model, query, searchResults, context }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return {
      answer: `Mock answer for: ${query}`,
      citations: searchResults.slice(0, 3).map(r => ({
        atSec: r.atSec ?? r.startSec ?? 0,
        source: r.source,
        text: r.text || '(frame)',
      })),
      suggestedFollowUps: ['mock follow-up 1', 'mock follow-up 2'],
    };
  }

  const evidence = buildEvidencePrompt(searchResults, context);

  const prompt = `You are a video analysis assistant. Answer the user's question using ONLY the evidence provided below. Every claim must be grounded in a specific timestamp.

QUESTION: ${query}

EVIDENCE:
${evidence}

Respond with valid JSON only:
{
  "answer": "Your answer here. Reference timestamps like (at 2:56) when citing evidence.",
  "citations": [
    {"atSec": 176.3, "source": "transcript", "text": "exact quote or description"},
    ...
  ],
  "suggestedFollowUps": ["follow-up question 1", "follow-up question 2", "follow-up question 3"]
}

Rules:
- Answer in 2-4 sentences. Be specific.
- Include 2-5 citations with exact timestamps and source type.
- Suggest 2-3 natural follow-up questions the user might ask next.
- If the evidence doesn't contain the answer, say so honestly.
- Return ONLY valid JSON, no other text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || JSON.stringify(payload);
    throw new Error(`Gemini ask failed: ${message}`);
  }

  const candidates = payload.candidates || [];
  const text = (candidates[0]?.content?.parts || [])
    .map(p => typeof p.text === 'string' ? p.text : '')
    .join('')
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { answer: text, citations: [], suggestedFollowUps: [] };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { answer: text, citations: [], suggestedFollowUps: [] };
  }
}

function buildEvidencePrompt(searchResults, context) {
  const parts = [];

  if (searchResults && searchResults.length > 0) {
    parts.push('SEARCH RESULTS:');
    for (const r of searchResults.slice(0, 5)) {
      const at = r.startSec ?? r.atSec ?? 0;
      const end = r.endSec ? `-${formatTime(r.endSec)}` : '';
      parts.push(`  [${formatTime(at)}${end}] (${r.source}) ${(r.text || '(frame)').slice(0, 200)}`);
    }
  }

  if (context) {
    if (context.utterances && context.utterances.length > 0) {
      parts.push('\nTRANSCRIPT CONTEXT:');
      for (const u of context.utterances) {
        parts.push(`  [${formatTime(u.startSec)}] ${u.text}`);
      }
    }

    if (context.ocrItems && context.ocrItems.length > 0) {
      parts.push('\nON-SCREEN TEXT:');
      for (const o of context.ocrItems) {
        parts.push(`  [${formatTime(o.atSec)}] ${o.text.slice(0, 150)}`);
      }
    }

    if (context.frames && context.frames.length > 0) {
      // Limit to ~5 frame descriptions to keep prompt short
      const sampled = context.frames.length <= 5
        ? context.frames
        : context.frames.filter((_, i) => i % Math.ceil(context.frames.length / 5) === 0);
      parts.push('\nVISUAL DESCRIPTIONS:');
      for (const f of sampled) {
        parts.push(`  [${formatTime(f.atSec)}] ${f.description.slice(0, 150)}`);
      }
    }
  }

  return parts.join('\n');
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

module.exports = { askQuestion };
