const fs = require('node:fs');
const path = require('node:path');
const { fetchWithTimeout } = require('./net');

function createDeepgramProvider() {
  if (process.env.VIDEO_CLI_MOCK_DEEPGRAM === '1') {
    return createMockDeepgramProvider();
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DEEPGRAM_API_KEY. Set it before using Deepgram-backed transcription.');
  }

  return {
    async ocrImage() {
      throw new Error('Deepgram does not support OCR image extraction in this CLI. Use the Gemini OCR provider.');
    },

    async transcribeAudio({
      audioPath,
      model,
      diarize = true,
      utterances = true,
      smartFormat = true,
      punctuate = true,
      detectLanguage = false,
      language = null,
    }) {
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.searchParams.set('model', model);
      url.searchParams.set('diarize', String(Boolean(diarize)));
      url.searchParams.set('utterances', String(Boolean(utterances)));
      url.searchParams.set('smart_format', String(Boolean(smartFormat)));
      url.searchParams.set('punctuate', String(Boolean(punctuate)));

      if (detectLanguage) {
        url.searchParams.set('detect_language', 'true');
      }
      if (language) {
        url.searchParams.set('language', String(language));
      }

      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': guessAudioMimeType(audioPath),
        },
        body: fs.readFileSync(audioPath),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Deepgram request failed: ${extractErrorMessage(payload)}`);
      }

      return normalizeTranscriptPayload(payload);
    },
  };
}

function normalizeTranscriptPayload(payload) {
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] || {};
  const transcript = typeof alternative.transcript === 'string' ? alternative.transcript.trim() : '';
  const words = Array.isArray(alternative.words)
    ? alternative.words.map(word => ({
      word: typeof word.word === 'string' ? word.word : '',
      startSec: roundToMillis(word.start),
      endSec: roundToMillis(word.end),
      confidence: typeof word.confidence === 'number' ? word.confidence : null,
      speaker: Number.isInteger(word.speaker) ? word.speaker : null,
      punctuatedWord: typeof word.punctuated_word === 'string' ? word.punctuated_word : null,
    }))
    : [];

  const utteranceSource = Array.isArray(payload?.results?.utterances)
    ? payload.results.utterances
    : Array.isArray(alternative.utterances)
      ? alternative.utterances
      : [];

  const utterances = utteranceSource.map(item => ({
    startSec: roundToMillis(item.start),
    endSec: roundToMillis(item.end),
    confidence: typeof item.confidence === 'number' ? item.confidence : null,
    speaker: Number.isInteger(item.speaker) ? item.speaker : null,
    transcript: typeof item.transcript === 'string' ? item.transcript.trim() : '',
  }));

  return {
    text: transcript,
    words,
    utterances,
  };
}

function extractErrorMessage(payload) {
  if (payload?.err_msg) {
    return payload.err_msg;
  }
  if (payload?.error?.message) {
    return payload.error.message;
  }
  return JSON.stringify(payload);
}

function guessAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    default:
      throw new Error(`Unsupported audio extension for Deepgram upload: ${ext}`);
  }
}

function roundToMillis(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(3)) : null;
}

function createMockDeepgramProvider() {
  return {
    async ocrImage() {
      throw new Error('Mock Deepgram provider does not support OCR.');
    },

    async transcribeAudio({ audioPath }) {
      const name = path.basename(audioPath, path.extname(audioPath));
      return {
        text: `mock deepgram transcript for ${name}`,
        words: [
          {
            word: 'mock',
            startSec: 0.1,
            endSec: 0.4,
            confidence: 0.99,
            speaker: 0,
            punctuatedWord: 'mock',
          },
          {
            word: 'transcript',
            startSec: 0.45,
            endSec: 0.9,
            confidence: 0.99,
            speaker: 0,
            punctuatedWord: 'transcript',
          },
        ],
        utterances: [
          {
            startSec: 0.1,
            endSec: 0.9,
            confidence: 0.99,
            speaker: 0,
            transcript: `mock deepgram transcript for ${name}`,
          },
        ],
      };
    },
  };
}

module.exports = {
  createDeepgramProvider,
};
