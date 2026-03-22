function collectTranscriptEntries(transcript) {
  const entries = [];

  if (!transcript || !Array.isArray(transcript.items)) {
    return entries;
  }

  for (const chunk of transcript.items) {
    if (Array.isArray(chunk.utterances) && chunk.utterances.length > 0) {
      for (const utterance of chunk.utterances) {
        const text = String(utterance.transcript || '').trim();
        if (!text) continue;
        entries.push({
          startSec: Number(utterance.startSec || 0),
          endSec: Number(utterance.endSec || utterance.startSec || 0),
          speaker: utterance.speaker ?? null,
          text,
        });
      }
      continue;
    }

    if (Array.isArray(chunk.segments) && chunk.segments.length > 0) {
      for (const segment of chunk.segments) {
        const text = String(segment.text || '').trim();
        if (!text) continue;
        entries.push({
          startSec: Number(segment.startSec || 0),
          endSec: Number(segment.endSec || segment.startSec || 0),
          speaker: segment.speaker ?? null,
          text,
        });
      }
      continue;
    }

    const chunkText = String(chunk.text || '').trim();
    if (!chunkText) {
      continue;
    }

    entries.push({
      startSec: Number(chunk.startSec || 0),
      endSec: Number(chunk.endSec || chunk.startSec || 0),
      speaker: chunk.speaker ?? null,
      text: chunkText,
    });
  }

  return entries;
}

module.exports = {
  collectTranscriptEntries,
};
