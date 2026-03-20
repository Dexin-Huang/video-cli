const fs = require('node:fs');
const path = require('node:path');
const { fetchWithTimeout, extractGeminiText, extractGeminiError, guessMimeType } = require('./net');

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
          apiKey, model, prompt,
          filePath: imagePath,
          mimeType: guessMimeType(imagePath),
        }),
      };
    },
  };
}

async function generateInlineContent({ apiKey, model, prompt, filePath, mimeType }) {
  const data = fs.readFileSync(filePath).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`Gemini request failed: ${extractGeminiError(payload)}`);
  }

  return extractGeminiText(payload);
}

function createMockGeminiProvider() {
  return {
    async ocrImage({ imagePath }) {
      const name = path.basename(imagePath, path.extname(imagePath));
      return { text: `mock ocr for ${name}` };
    },
  };
}

module.exports = { createGeminiProvider };
