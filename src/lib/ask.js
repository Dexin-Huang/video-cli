const { fetchWithRetry, extractGeminiText, extractGeminiError } = require('./net');

async function askQuestion({ apiKey, model, query, searchResults, context, videoId }) {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return {
      answer: `Mock answer for: ${query}`,
      citations: searchResults.slice(0, 3).map(r => ({
        atSec: r.atSec ?? r.startSec ?? 0,
        source: r.source,
        text: r.text || '(frame)',
        framePath: r.framePath || null,
      })),
      suggestedFollowUps: ['mock follow-up 1', 'mock follow-up 2'],
      hints: [],
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
  "suggestedFollowUps": ["follow-up question 1", "follow-up question 2", "follow-up question 3"],
  "confidence": "high" or "partial" or "low"
}

Rules:
- Answer in 2-4 sentences. Be specific.
- Include 2-5 citations with exact timestamps and source type.
- Suggest 2-3 natural follow-up questions the user might ask next.
- If the evidence doesn't contain the answer, say so honestly.
- Set confidence to "high" if the evidence fully answers the question, "partial" if only part of the answer is found, "low" if the evidence is insufficient.
- Return ONLY valid JSON, no other text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini ask failed: ${extractGeminiError(payload)}`);
  }

  const text = extractGeminiText(payload);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let result;
  try {
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: text, citations: [], suggestedFollowUps: [], confidence: 'low' };
  } catch {
    result = { answer: text, citations: [], suggestedFollowUps: [], confidence: 'low' };
  }

  // Attach frame paths to citations
  result.citations = attachFramePaths(result.citations || [], searchResults, context);

  // Generate hints based on result quality
  result.hints = generateHints(result, searchResults, videoId);

  return result;
}

function attachFramePaths(citations, searchResults, context) {
  return citations.map(c => {
    if (c.framePath) return c;
    const atSec = c.atSec ?? 0;
    for (const r of (searchResults || [])) {
      if (Math.abs((r.atSec ?? r.startSec ?? 0) - atSec) < 5 && r.framePath) return { ...c, framePath: r.framePath };
    }
    if (context && context.frames) {
      let nearest = null, nearestDist = Infinity;
      for (const f of context.frames) {
        const dist = Math.abs(f.atSec - atSec);
        if (dist < nearestDist && f.framePath) { nearest = f; nearestDist = dist; }
      }
      if (nearest && nearestDist < 10) return { ...c, framePath: nearest.framePath };
    }
    return c;
  });
}

function generateHints(result, searchResults, videoId) {
  const hints = [];
  const confidence = result.confidence || 'high';
  if (confidence === 'partial' || confidence === 'low') {
    const ts = (searchResults || []).map(r => r.atSec ?? r.startSec ?? 0);
    if (ts.length >= 2 && Math.max(...ts) - Math.min(...ts) > 60) {
      hints.push({ type: 'try_chapters', message: 'This question spans the full video. Try: video-cli chapters ' + videoId });
    }
    hints.push({ type: 'try_broader_search', message: 'Try rephrasing or use: video-cli search ' + videoId + ' "<broader query>"' });
  }
  const frameCitation = (result.citations || []).find(c => c.framePath);
  if (frameCitation) {
    hints.push({ type: 'view_frame', message: 'Visual evidence available. The frame path can be read directly by multimodal models.', framePath: frameCitation.framePath });
  }
  return hints;
}

function buildEvidencePrompt(searchResults, context) {
  const parts = [];
  if (searchResults && searchResults.length > 0) {
    parts.push('SEARCH RESULTS:');
    for (const r of searchResults.slice(0, 5)) {
      const end = r.endSec ? `-${formatTime(r.endSec)}` : '';
      parts.push(`  [${formatTime(r.startSec ?? r.atSec ?? 0)}${end}] (${r.source}) ${(r.text || '(frame)').slice(0, 200)}`);
    }
  }
  if (context) {
    if (context.utterances?.length > 0) {
      parts.push('\nTRANSCRIPT CONTEXT:');
      for (const u of context.utterances) parts.push(`  [${formatTime(u.startSec)}] ${u.text}`);
    }
    if (context.ocrItems?.length > 0) {
      parts.push('\nON-SCREEN TEXT:');
      for (const o of context.ocrItems) parts.push(`  [${formatTime(o.atSec)}] ${o.text.slice(0, 150)}`);
    }
    if (context.frames?.length > 0) {
      const step = Math.ceil(context.frames.length / 5);
      const sampled = context.frames.length <= 5 ? context.frames : context.frames.filter((_, i) => i % step === 0);
      parts.push('\nVISUAL DESCRIPTIONS:');
      for (const f of sampled) parts.push(`  [${formatTime(f.atSec)}] ${f.description.slice(0, 150)}`);
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
