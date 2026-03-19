const fs = require('node:fs');
const path = require('node:path');

function createGeminiProvider() {
  if (process.env.VIDEO_CLI_MOCK_GEMINI === '1') {
    return createMockGeminiProvider();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Set it before using Gemini-backed commands.');
  }

  return {
    async ocrImage({ imagePath, model, prompt }) {
      return {
        text: await generateInlineContent({
          apiKey,
          model,
          prompt,
          filePath: imagePath,
          mimeType: guessMimeType(imagePath),
        }),
      };
    },

    async transcribeAudio({ audioPath, model, prompt }) {
      return {
        text: await generateInlineContent({
          apiKey,
          model,
          prompt,
          filePath: audioPath,
          mimeType: guessMimeType(audioPath),
        }),
        words: [],
        utterances: [],
      };
    },
  };
}

async function generateInlineContent({ apiKey, model, prompt, filePath, mimeType }) {
  const data = fs.readFileSync(filePath).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Gemini request failed: ${extractErrorMessage(payload)}`);
    }

    return extractText(payload).trim();
  } finally {
    clearTimeout(timeout);
  }
}

function extractText(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts
    .map(part => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim();
}

function extractErrorMessage(payload) {
  if (payload?.error?.message) {
    return payload.error.message;
  }
  return JSON.stringify(payload);
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    default:
      throw new Error(`Unsupported media extension for Gemini inline upload: ${ext}`);
  }
}

function createMockGeminiProvider() {
  return {
    async ocrImage({ imagePath }) {
      const name = path.basename(imagePath, path.extname(imagePath));
      return {
        text: `mock ocr for ${name}`,
      };
    },
    async transcribeAudio({ audioPath }) {
      const name = path.basename(audioPath, path.extname(audioPath));
      return {
        text: `mock transcript for ${name}`,
        words: [],
        utterances: [],
      };
    },
  };
}

module.exports = {
  createGeminiProvider,
};
