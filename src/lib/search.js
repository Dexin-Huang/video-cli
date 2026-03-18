function findMatches({ query, ocr, transcript }) {
  const needle = String(query || '').toLowerCase();
  const matches = [];

  if (!needle) {
    return matches;
  }

  if (ocr && Array.isArray(ocr.items)) {
    for (const item of ocr.items) {
      if (!item.text || !item.text.toLowerCase().includes(needle)) {
        continue;
      }
      matches.push({
        source: 'ocr',
        atSec: item.atSec,
        framePath: item.framePath,
        text: item.text,
      });
    }
  }

  if (transcript && Array.isArray(transcript.items)) {
    for (const item of transcript.items) {
      appendTranscriptMatches(matches, item, needle);
    }
  }

  matches.sort(compareMatches);
  return matches;
}

function appendTranscriptMatches(matches, item, needle) {
  let matched = false;

  if (Array.isArray(item.utterances) && item.utterances.length > 0) {
    for (const utterance of item.utterances) {
      if (!utterance.transcript || !utterance.transcript.toLowerCase().includes(needle)) {
        continue;
      }
      matches.push({
        source: 'transcript',
        startSec: utterance.startSec,
        endSec: utterance.endSec,
        speaker: utterance.speaker ?? null,
        text: utterance.transcript,
      });
      matched = true;
    }
  }

  if (!matched && Array.isArray(item.segments) && item.segments.length > 0) {
    for (const segment of item.segments) {
      if (!segment.text || !segment.text.toLowerCase().includes(needle)) {
        continue;
      }
      matches.push({
        source: 'transcript',
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
      });
      matched = true;
    }
  }

  if (!matched && item.text && item.text.toLowerCase().includes(needle)) {
    matches.push({
      source: 'transcript',
      startSec: item.startSec,
      endSec: item.endSec,
      text: item.text,
    });
  }
}

function compareMatches(left, right) {
  const leftAt = left.atSec ?? left.startSec ?? 0;
  const rightAt = right.atSec ?? right.startSec ?? 0;
  return leftAt - rightAt;
}

function mergeSemanticAndLexical({ semanticMatches, lexicalMatches, topK, threshold }) {
  const byKey = new Map();
  const safeThreshold = Number.isFinite(threshold) ? threshold : 0;
  const safeTopK = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : 10;

  for (const item of (semanticMatches || [])) {
    const key = matchKey(item);
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, { ...item });
    }
  }

  const lexicalScore = 0.5;
  for (const item of (lexicalMatches || [])) {
    const key = matchKey(item);
    const existing = byKey.get(key);
    const score = existing ? Math.max(existing.score, lexicalScore) : lexicalScore;
    if (!existing) {
      byKey.set(key, { ...item, score });
    } else if (score > existing.score) {
      existing.score = score;
    }
  }

  const results = Array.from(byKey.values())
    .filter(item => item.score >= safeThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeTopK);

  return results;
}

function matchKey(item) {
  const at = item.atSec ?? item.startSec ?? 0;
  return `${item.source}:${at}`;
}

module.exports = {
  findMatches,
  mergeSemanticAndLexical,
};
