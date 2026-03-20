const DEFAULT_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts.map(p => typeof p.text === 'string' ? p.text : '').join('\n').trim();
}

function extractGeminiError(payload) {
  return payload?.error?.message || JSON.stringify(payload);
}

function guessMimeType(filePath) {
  const ext = require('node:path').extname(filePath).toLowerCase();
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
      return 'application/octet-stream';
  }
}

async function batchAsync(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

module.exports = {
  batchAsync,
  fetchWithTimeout,
  extractGeminiText,
  extractGeminiError,
  guessMimeType,
};
