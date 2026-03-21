const fs = require('node:fs');
const path = require('node:path');

const BUILTIN_PRESETS = {
  // Golden path: Gemini for everything. One API key, one provider.
  // Override with --provider elevenlabs for word-level timestamps + audio events.
  balanced: {
    preset: 'balanced',
    ocr: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite-preview',
      watchpointLimit: 8,
    },
    transcribe: {
      provider: 'gemini-transcribe',
      model: 'gemini-3.1-flash-lite-preview',
      chunkSeconds: 480,
      trimSilence: false,
      minSilenceSec: 1.5,
      padSec: 0.25,
      silenceNoiseDb: -35,
      diarize: true,
      utterances: true,
      smartFormat: true,
      punctuate: true,
      detectLanguage: false,
      language: null,
    },
    embed: {
      provider: 'gemini',
      model: 'gemini-embedding-2-preview',
      dimensions: 768,
      taskTypeDocument: 'RETRIEVAL_DOCUMENT',
      taskTypeQuery: 'RETRIEVAL_QUERY',
      sources: {
        transcript: true,
        ocr: true,
        frames: false,  // frame descriptions are already embedded as text via analyze
      },
    },
  },
};

function getRuntimeConfig(repoRoot) {
  const userConfigPath = path.join(repoRoot, 'video-cli.config.json');
  const userConfig = fs.existsSync(userConfigPath)
    ? JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
    : {};

  const presetName = String(
    process.env.VIDEO_CLI_PRESET ||
    userConfig.preset ||
    'balanced'
  );

  const preset = BUILTIN_PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const merged = deepMerge(preset, userConfig);

  const e = process.env;
  const str = (target, key, ...envKeys) => {
    const val = envKeys.reduce((v, k) => v || e[k], undefined);
    if (val) target[key] = val;
  };
  const num = (target, key, envKey) => { if (e[envKey]) target[key] = Number(e[envKey]); };
  const bool = (target, key, envKey) => { if (e[envKey]) target[key] = parseBooleanEnv(e[envKey]); };

  str(merged.ocr, 'provider', 'VIDEO_CLI_OCR_PROVIDER');
  str(merged.ocr, 'model', 'VIDEO_CLI_OCR_MODEL', 'GEMINI_OCR_MODEL');
  str(merged.transcribe, 'provider', 'VIDEO_CLI_TRANSCRIBE_PROVIDER');
  str(merged.transcribe, 'model', 'VIDEO_CLI_TRANSCRIBE_MODEL', 'DEEPGRAM_TRANSCRIBE_MODEL', 'GEMINI_TRANSCRIBE_MODEL');
  num(merged.transcribe, 'chunkSeconds', 'VIDEO_CLI_TRANSCRIBE_CHUNK_SECONDS');
  bool(merged.transcribe, 'trimSilence', 'VIDEO_CLI_TRANSCRIBE_TRIM_SILENCE');
  num(merged.transcribe, 'minSilenceSec', 'VIDEO_CLI_TRANSCRIBE_MIN_SILENCE_SEC');
  num(merged.transcribe, 'padSec', 'VIDEO_CLI_TRANSCRIBE_PAD_SEC');
  num(merged.transcribe, 'silenceNoiseDb', 'VIDEO_CLI_TRANSCRIBE_SILENCE_NOISE_DB');
  bool(merged.transcribe, 'diarize', 'VIDEO_CLI_TRANSCRIBE_DIARIZE');
  bool(merged.transcribe, 'utterances', 'VIDEO_CLI_TRANSCRIBE_UTTERANCES');
  bool(merged.transcribe, 'smartFormat', 'VIDEO_CLI_TRANSCRIBE_SMART_FORMAT');
  bool(merged.transcribe, 'punctuate', 'VIDEO_CLI_TRANSCRIBE_PUNCTUATE');
  bool(merged.transcribe, 'detectLanguage', 'VIDEO_CLI_TRANSCRIBE_DETECT_LANGUAGE');
  str(merged.transcribe, 'language', 'VIDEO_CLI_TRANSCRIBE_LANGUAGE');
  str(merged.embed, 'provider', 'VIDEO_CLI_EMBED_PROVIDER');
  str(merged.embed, 'model', 'VIDEO_CLI_EMBED_MODEL');
  num(merged.embed, 'dimensions', 'VIDEO_CLI_EMBED_DIMENSIONS');
  bool(merged.embed.sources, 'transcript', 'VIDEO_CLI_EMBED_TRANSCRIPT');
  bool(merged.embed.sources, 'ocr', 'VIDEO_CLI_EMBED_OCR');
  bool(merged.embed.sources, 'frames', 'VIDEO_CLI_EMBED_FRAMES');

  return merged;
}

function deepMerge(base, override) {
  const output = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      output[key] = deepMerge(base[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function parseBooleanEnv(value) {
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean environment value: ${value}`);
}

module.exports = {
  getRuntimeConfig,
};
