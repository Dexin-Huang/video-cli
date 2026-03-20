const fs = require('node:fs');
const path = require('node:path');
const { fetchWithTimeout, guessMimeType } = require('./net');

function createElevenLabsProvider() {
  if (process.env.VIDEO_CLI_MOCK_ELEVENLABS === '1') {
    return createMockElevenLabsProvider();
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ELEVENLABS_API_KEY. Set it before using ElevenLabs-backed commands.');
  }

  return {
    async ocrImage() {
      throw new Error('ElevenLabs does not support OCR. Use the Gemini provider instead.');
    },

    async transcribeAudio({ audioPath, diarize, language }) {
      const audioData = fs.readFileSync(audioPath);
      const ext = path.extname(audioPath).toLowerCase();
      const mimeType = guessMimeType(audioPath);

      const formData = new FormData();
      formData.append('file', new Blob([audioData], { type: mimeType }), `audio${ext}`);
      formData.append('model_id', 'scribe_v2');
      formData.append('timestamps_granularity', 'word');
      if (diarize) {
        formData.append('diarize', 'true');
      }
      formData.append('tag_audio_events', 'true');
      if (language) {
        formData.append('language_code', language);
      }

      const response = await fetchWithTimeout(
        'https://api.elevenlabs.io/v1/speech-to-text',
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: formData,
        },
        60000, // 60s timeout for transcription
      );

      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.detail?.message || payload?.detail || JSON.stringify(payload);
        throw new Error(`ElevenLabs transcription failed: ${message}`);
      }

      return normalizePayload(payload);
    },
  };
}

function normalizePayload(payload) {
  const words = [];
  const utterances = [];
  const audioEvents = [];

  if (Array.isArray(payload.words)) {
    for (const w of payload.words) {
      if (w.type === 'audio_event') {
        audioEvents.push({
          event: w.text || w.audio_event || 'unknown',
          startSec: roundMs(w.start || 0),
          endSec: roundMs(w.end || 0),
        });
        continue;
      }

      words.push({
        word: (w.text || '').toLowerCase().replace(/[^\w'-]/g, ''),
        startSec: roundMs(w.start || 0),
        endSec: roundMs(w.end || 0),
        confidence: w.confidence ?? null,
        speaker: w.speaker_id != null ? parseSpeaker(w.speaker_id) : null,
        punctuatedWord: w.text || '',
      });
    }
  }

  // Filter out empty/whitespace-only words
  const realWords = words.filter(w => w.word.trim().length > 0);

  // Build utterances: split on sentence-ending punctuation, speaker change, or pauses > 1s
  let currentUtt = null;
  for (const w of realWords) {
    const gap = currentUtt ? w.startSec - currentUtt.endSec : 0;
    const sameSpeaker = currentUtt && currentUtt.speaker === w.speaker;
    const prevEndedSentence = currentUtt && /[.!?]$/.test(currentUtt.transcript.trim());

    if (!currentUtt || gap > 1.0 || !sameSpeaker || prevEndedSentence) {
      if (currentUtt) {
        currentUtt.transcript = currentUtt.transcript.replace(/\s+/g, ' ').trim();
        utterances.push(currentUtt);
      }
      currentUtt = {
        startSec: w.startSec,
        endSec: w.endSec,
        confidence: w.confidence,
        speaker: w.speaker,
        transcript: w.punctuatedWord,
      };
    } else {
      currentUtt.endSec = w.endSec;
      currentUtt.transcript += ' ' + w.punctuatedWord;
      if (w.confidence != null && currentUtt.confidence != null) {
        currentUtt.confidence = (currentUtt.confidence + w.confidence) / 2;
      }
    }
  }
  if (currentUtt) {
    currentUtt.transcript = currentUtt.transcript.replace(/\s+/g, ' ').trim();
    utterances.push(currentUtt);
  }

  const text = utterances.map(u => u.transcript).join(' ').trim();

  return {
    text,
    words,
    utterances,
    audioEvents,
    languageCode: payload.language_code || null,
    languageProbability: payload.language_probability ?? null,
  };
}

function parseSpeaker(speakerId) {
  if (typeof speakerId === 'number') return speakerId;
  const match = String(speakerId).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function roundMs(sec) {
  return Number(Number(sec).toFixed(3));
}

function createMockElevenLabsProvider() {
  return {
    async ocrImage() {
      throw new Error('Mock ElevenLabs provider does not support OCR.');
    },
    async transcribeAudio({ audioPath }) {
      const name = path.basename(audioPath, path.extname(audioPath));
      return {
        text: `mock elevenlabs transcript for ${name}`,
        words: [
          { word: 'mock', startSec: 0.1, endSec: 0.4, confidence: 0.99, speaker: 0, punctuatedWord: 'mock' },
          { word: 'elevenlabs', startSec: 0.4, endSec: 0.7, confidence: 0.99, speaker: 0, punctuatedWord: 'elevenlabs' },
          { word: 'transcript', startSec: 0.7, endSec: 0.9, confidence: 0.99, speaker: 0, punctuatedWord: 'transcript' },
        ],
        utterances: [
          { startSec: 0.1, endSec: 0.9, confidence: 0.99, speaker: 0, transcript: `mock elevenlabs transcript for ${name}` },
        ],
        audioEvents: [
          { event: '(laughter)', startSec: 0.5, endSec: 0.6 },
        ],
      };
    },
  };
}

module.exports = { createElevenLabsProvider };
