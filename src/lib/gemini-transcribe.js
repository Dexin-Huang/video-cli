const fs = require('node:fs');
const path = require('node:path');
const { fetchWithRetry, extractGeminiText, extractGeminiError, batchAsync } = require('./net');

const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_CHUNK_SEC = 90;
const MIN_CHUNK_SEC = 15;

function createGeminiTranscribeProvider() {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return createMockProvider();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Add it to .env or set the environment variable.');
  }

  return {
    async ocrImage() {
      throw new Error('Use the gemini provider for OCR.');
    },

    async transcribeAudio({ audioPath, model }) {
      // Always use a Gemini model, ignore ElevenLabs/Deepgram model names from config
      const useModel = (model && model.startsWith('gemini')) ? model : DEFAULT_MODEL;
      const audioData = fs.readFileSync(audioPath).toString('base64');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'audio/mpeg', data: audioData } },
              { text: TRANSCRIPT_PROMPT },
            ],
          }],
          generationConfig: { temperature: 0.0, maxOutputTokens: 8000 },
        }),
      }, { timeoutMs: 60000 });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Gemini transcription failed: ${extractGeminiError(payload)}`);
      }

      const text = extractGeminiText(payload);
      return parseTranscriptResponse(text);
    },
  };
}

const TRANSCRIPT_PROMPT = `Transcribe this audio into utterances. Return ONLY a valid JSON array, nothing else.

Format: [{"startSec": 0.0, "endSec": 4.5, "text": "the spoken words"}]

Rules:
- Each utterance is a natural sentence or phrase (3-30 seconds)
- Timestamps must be accurate to within 1 second
- Include ALL spoken content, do not skip anything
- Use proper punctuation and capitalization
- If multiple speakers, add "speaker": 0 or "speaker": 1
- Return ONLY the JSON array, no markdown, no explanation`;

function parseTranscriptResponse(text) {
  // Extract JSON array, handling potential garbage after valid JSON
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  let jsonStr = cleaned;

  // Find the array bounds
  const start = cleaned.indexOf('[');
  if (start === -1) {
    return { text: cleaned, words: [], utterances: [] };
  }

  // Parse incrementally — find the last valid closing bracket
  let depth = 0;
  let end = start;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '[') depth++;
    if (cleaned[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  jsonStr = cleaned.slice(start, end + 1);

  let utterances;
  try {
    utterances = JSON.parse(jsonStr);
  } catch {
    // Try fixing common issues: trailing comma, incomplete last entry
    try {
      // Remove last incomplete entry and close the array
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        utterances = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
      } else {
        return { text: cleaned, words: [], utterances: [] };
      }
    } catch {
      return { text: cleaned, words: [], utterances: [] };
    }
  }

  if (!Array.isArray(utterances)) {
    return { text: cleaned, words: [], utterances: [] };
  }

  // Filter out entries with box_2d or other garbage
  const valid = utterances.filter(u =>
    typeof u.startSec === 'number' &&
    typeof u.endSec === 'number' &&
    typeof u.text === 'string' &&
    !u.box_2d
  );

  const fullText = valid.map(u => u.text).join(' ');

  // Build word-level data from utterances (approximate — split on spaces)
  const words = [];
  for (const u of valid) {
    const uWords = u.text.split(/\s+/).filter(Boolean);
    const duration = u.endSec - u.startSec;
    const step = uWords.length > 0 ? duration / uWords.length : 0;
    for (let i = 0; i < uWords.length; i++) {
      words.push({
        word: uWords[i].toLowerCase().replace(/[^\w'-]/g, ''),
        startSec: Number((u.startSec + i * step).toFixed(3)),
        endSec: Number((u.startSec + (i + 1) * step).toFixed(3)),
        confidence: null,
        speaker: u.speaker ?? null,
        punctuatedWord: uWords[i],
      });
    }
  }

  return {
    text: fullText,
    words,
    utterances: valid.map(u => ({
      startSec: Number(u.startSec.toFixed(3)),
      endSec: Number(u.endSec.toFixed(3)),
      confidence: null,
      speaker: u.speaker ?? 0,
      transcript: u.text,
    })),
    audioEvents: [],
  };
}

function createMockProvider() {
  return {
    async ocrImage() { throw new Error('Mock gemini-transcribe does not support OCR.'); },
    async transcribeAudio({ audioPath }) {
      const name = path.basename(audioPath, path.extname(audioPath));
      return {
        text: `mock gemini transcript for ${name}`,
        words: [
          { word: 'mock', startSec: 0.1, endSec: 0.3, confidence: null, speaker: 0, punctuatedWord: 'mock' },
          { word: 'gemini', startSec: 0.3, endSec: 0.6, confidence: null, speaker: 0, punctuatedWord: 'gemini' },
          { word: 'transcript', startSec: 0.6, endSec: 0.9, confidence: null, speaker: 0, punctuatedWord: 'transcript' },
        ],
        utterances: [
          { startSec: 0.1, endSec: 0.9, confidence: null, speaker: 0, transcript: `mock gemini transcript for ${name}` },
        ],
        audioEvents: [],
      };
    },
  };
}

module.exports = { createGeminiTranscribeProvider };
