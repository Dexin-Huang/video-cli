const { cosineSimilarity } = require('./embed');
const { collectTranscriptEntries } = require('./transcript');

const STOP_WORDS = new Set('the and that this with from have are was were for not they what been will when your like just also about into more some very then there here these those would could other than show where which does scene moment visual first after before during being make made'.split(' '));

function findMatches({ query, ocr, transcript }) {
  const needle = String(query || '').toLowerCase();
  const matches = [];

  if (!needle) return matches;

  if (ocr && Array.isArray(ocr.items)) {
    for (const item of ocr.items) {
      if (!item.text || !item.text.toLowerCase().includes(needle)) continue;
      matches.push({ source: 'ocr', atSec: item.atSec, framePath: item.framePath, text: item.text });
    }
  }

  if (transcript && Array.isArray(transcript.items)) {
    for (const item of transcript.items) {
      appendTranscriptMatches(matches, item, needle);

      // Search audio events (laughter, applause, music, etc.)
      if (Array.isArray(item.audioEvents)) {
        for (const event of item.audioEvents) {
          if (event.event && event.event.toLowerCase().includes(needle)) {
            matches.push({
              source: 'audio_event',
              startSec: event.startSec,
              endSec: event.endSec,
              text: event.event,
            });
          }
        }
      }
    }
  }

  matches.sort(compareByTime);
  return matches;
}

function appendTranscriptMatches(matches, item, needle) {
  let matched = false;

  if (Array.isArray(item.utterances) && item.utterances.length > 0) {
    for (const utt of item.utterances) {
      if (!utt.transcript || !utt.transcript.toLowerCase().includes(needle)) continue;
      matches.push({ source: 'transcript', startSec: utt.startSec, endSec: utt.endSec, speaker: utt.speaker ?? null, text: utt.transcript });
      matched = true;
    }
  }

  if (!matched && Array.isArray(item.segments) && item.segments.length > 0) {
    for (const seg of item.segments) {
      if (!seg.text || !seg.text.toLowerCase().includes(needle)) continue;
      matches.push({ source: 'transcript', startSec: seg.startSec, endSec: seg.endSec, text: seg.text });
      matched = true;
    }
  }

  if (!matched && item.text && item.text.toLowerCase().includes(needle)) {
    matches.push({ source: 'transcript', startSec: item.startSec, endSec: item.endSec, text: item.text });
  }
}

function semanticSearch({ query, queryVec, embeddings, lexicalMatches, descriptions, topK }) {
  const byKey = new Map();
  const q = (query || '').toLowerCase();
  const terms = q.split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const stems = terms.map(w => w.length > 5 ? w.slice(0, 4) : w);

  // Cosine scoring of embeddings
  for (const item of (embeddings || [])) {
    if (item.source === 'ocr' && item.text && item.text.length < 10) continue;
    const at = item.atSec ?? item.startSec ?? 0;
    byKey.set(`${item.source}:${at}`, {
      score: cosineSimilarity(queryVec, item.vector),
      source: item.source, index: item.index, atSec: item.atSec ?? null,
      startSec: item.startSec ?? null, endSec: item.endSec ?? null,
      speaker: item.speaker ?? null, framePath: item.framePath ?? null, text: item.text ?? null,
    });
  }

  // Z-normalize scores by source type
  zNormalizeScores(Array.from(byKey.values()));

  // Lexical boost (post-normalization)
  for (const lex of (lexicalMatches || [])) {
    const ex = byKey.get(`${lex.source}:${lex.atSec ?? lex.startSec ?? 0}`);
    if (ex) ex.score += 1.0;
  }

  // IDF-weighted description search
  if (stems.length > 0 && descriptions && Array.isArray(descriptions.items)) {
    const items = descriptions.items;
    const df = {};
    for (const d of items) {
      const dt = (d.description || '').toLowerCase();
      for (let i = 0; i < stems.length; i += 1) {
        if (dt.includes(stems[i])) df[terms[i]] = (df[terms[i]] || 0) + 1;
      }
    }
    const N = items.length;
    const isVisual = /\b(show|scene|visual|graphic|display|image|diagram|wearing|appear|look)\b/.test(q);

    for (const d of items) {
      if (!d.description) continue;
      const dt = d.description.toLowerCase();
      let idf = 0;
      let hits = 0;
      for (let i = 0; i < stems.length; i += 1) {
        if (dt.includes(stems[i])) {
          hits += 1;
          idf += Math.log(N / (df[terms[i]] || 1));
        }
      }
      if (hits >= 2 || (hits >= 1 && terms.length <= 2)) {
        const dk = `description:${d.atSec}`;
        if (!byKey.has(dk)) {
          byKey.set(dk, {
            score: (isVisual ? 0.8 : 0.5) + idf * 0.3,
            source: 'description', atSec: d.atSec,
            startSec: null, endSec: null, text: d.description,
            speaker: null, framePath: null,
          });
        }
      }
    }
  }

  // Sort, dedup within 1s, construct spans, return top-K
  let results = Array.from(byKey.values()).sort((a, b) => b.score - a.score);
  const kept = [];
  for (const r of results) {
    const at = r.atSec ?? r.startSec ?? 0;
    if (!kept.some(k => Math.abs(at - (k.atSec ?? k.startSec ?? 0)) < 1)) {
      kept.push(r);
    }
  }
  for (const r of kept) {
    if (r.atSec != null && r.startSec == null) {
      r.startSec = Math.max(0, r.atSec - 2);
      r.endSec = r.atSec + 2;
    }
    if (r.startSec != null && r.endSec != null && r.endSec - r.startSec > 15) {
      r.endSec = r.startSec + 15;
    }
  }
  return kept.slice(0, topK || 5);
}

function getContext({ atSec, windowSec, transcript, ocr, descriptions, manifest }) {
  const startSec = Math.max(0, atSec - windowSec);
  const endSec = atSec + windowSec;

  const utterances = [];
  const audioEvents = [];
  for (const entry of collectTranscriptEntries(transcript)) {
    if (entry.endSec > startSec && entry.startSec < endSec) {
      utterances.push(entry);
    }
  }

  if (transcript && Array.isArray(transcript.items)) {
    for (const chunk of transcript.items) {
      for (const event of (chunk.audioEvents || [])) {
        if (event.startSec >= startSec && event.startSec <= endSec) audioEvents.push(event);
      }
    }
  }

  const ocrItems = [];
  if (ocr && Array.isArray(ocr.items)) {
    for (const item of ocr.items) {
      if (item.atSec >= startSec && item.atSec <= endSec) ocrItems.push({ atSec: item.atSec, text: item.text, framePath: item.framePath });
    }
  }

  const frames = [];
  if (descriptions && Array.isArray(descriptions.items)) {
    for (const d of descriptions.items) {
      if (d.atSec >= startSec && d.atSec <= endSec) frames.push({ atSec: d.atSec, description: d.description, framePath: d.framePath || null });
    }
  }

  const sceneChanges = [];
  if (manifest && manifest.sceneDetection && Array.isArray(manifest.sceneDetection.changePointsSec)) {
    for (const t of manifest.sceneDetection.changePointsSec) {
      if (t >= startSec && t <= endSec) sceneChanges.push(t);
    }
  }

  return {
    atSec, windowSec, startSec, endSec,
    utterances, ocrItems, frames, sceneChanges, audioEvents,
    suggestedCommands: [
      `video-cli frame <id> --at ${atSec}`,
      `video-cli clip <id> --at ${atSec} --pre 5 --post 10`,
      `video-cli next <id> --from ${endSec}`,
    ],
  };
}

function buildChapters({ manifest, transcript, descriptions }) {
  const durationSec = manifest.media.durationSec;
  const changePoints = (manifest.sceneDetection && manifest.sceneDetection.changePointsSec) || [];

  // Collect all utterances with timestamps
  const utterances = collectTranscriptEntries(transcript);

  // Build chapter boundaries from scene change clusters
  // Group change points that are within 15s of each other
  const boundaries = [0];
  const minChapterSec = 20;

  for (const cp of changePoints) {
    const lastBoundary = boundaries[boundaries.length - 1];
    if (cp - lastBoundary >= minChapterSec) {
      boundaries.push(cp);
    }
  }
  boundaries.push(durationSec);

  // Build chapters from boundaries
  const chapters = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const startSec = Number(boundaries[i].toFixed(3));
    const endSec = Number(boundaries[i + 1].toFixed(3));

    const chapterUtterances = utterances.filter(u => u.endSec > startSec && u.startSec < endSec);
    const text = chapterUtterances.map(u => u.text).join(' ').trim();

    // Get description for the midpoint if available
    let summary = null;
    if (descriptions && Array.isArray(descriptions.items)) {
      const mid = (startSec + endSec) / 2;
      const nearest = descriptions.items.reduce((best, d) =>
        Math.abs(d.atSec - mid) < Math.abs((best ? best.atSec : Infinity) - mid) ? d : best, null);
      if (nearest) summary = nearest.description;
    }

    chapters.push({
      index: i,
      startSec,
      endSec,
      durationSec: Number((endSec - startSec).toFixed(3)),
      utteranceCount: chapterUtterances.length,
      text: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
      summary,
    });
  }

  return chapters;
}

function findNext({ fromSec, transcript, ocr, descriptions, manifest }) {
  const candidates = [];

  // Next scene change
  if (manifest && manifest.sceneDetection && Array.isArray(manifest.sceneDetection.changePointsSec)) {
    for (const t of manifest.sceneDetection.changePointsSec) {
      if (t > fromSec + 1) {
        candidates.push({ atSec: t, type: 'scene_change', text: 'Scene change detected' });
        break;
      }
    }
  }

  // Next utterance start
  for (const entry of collectTranscriptEntries(transcript)) {
    if (entry.startSec > fromSec + 1) {
      candidates.push({
        atSec: entry.startSec,
        type: 'utterance',
        text: entry.text,
        endSec: entry.endSec,
        speaker: entry.speaker ?? null,
      });
      break;
    }
  }

  // Next OCR item
  if (ocr && Array.isArray(ocr.items)) {
    for (const item of ocr.items) {
      if (item.atSec > fromSec + 1) {
        candidates.push({ atSec: item.atSec, type: 'ocr', text: item.text, framePath: item.framePath });
        break;
      }
    }
  }

  // Next description
  if (descriptions && Array.isArray(descriptions.items)) {
    for (const d of descriptions.items) {
      if (d.atSec > fromSec + 1) {
        candidates.push({ atSec: d.atSec, type: 'description', text: d.description });
        break;
      }
    }
  }

  // Return the earliest candidate
  candidates.sort((a, b) => a.atSec - b.atSec);
  return candidates[0] || null;
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
}

function compareByTime(left, right) {
  return (left.atSec ?? left.startSec ?? 0) - (right.atSec ?? right.startSec ?? 0);
}

module.exports = {
  findMatches,
  semanticSearch,
  getContext,
  buildChapters,
  findNext,
};
