const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PRESET = 'balanced';

const BUILTIN_PRESETS = {
  balanced: {
    preset: 'balanced',
    ocr: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite-preview',
      watchpointLimit: 8,
    },
    transcribe: {
      provider: 'deepgram',
      model: 'nova-3',
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
        frames: true,
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
    DEFAULT_PRESET
  );

  const preset = BUILTIN_PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  const merged = deepMerge(preset, userConfig);

  if (process.env.VIDEO_CLI_OCR_PROVIDER) {
    merged.ocr.provider = process.env.VIDEO_CLI_OCR_PROVIDER;
  }
  if (process.env.VIDEO_CLI_OCR_MODEL || process.env.GEMINI_OCR_MODEL) {
    merged.ocr.model = process.env.VIDEO_CLI_OCR_MODEL || process.env.GEMINI_OCR_MODEL;
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_PROVIDER) {
    merged.transcribe.provider = process.env.VIDEO_CLI_TRANSCRIBE_PROVIDER;
  }
  if (
    process.env.VIDEO_CLI_TRANSCRIBE_MODEL ||
    process.env.DEEPGRAM_TRANSCRIBE_MODEL ||
    process.env.GEMINI_TRANSCRIBE_MODEL
  ) {
    merged.transcribe.model =
      process.env.VIDEO_CLI_TRANSCRIBE_MODEL ||
      process.env.DEEPGRAM_TRANSCRIBE_MODEL ||
      process.env.GEMINI_TRANSCRIBE_MODEL;
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_CHUNK_SECONDS) {
    merged.transcribe.chunkSeconds = Number(process.env.VIDEO_CLI_TRANSCRIBE_CHUNK_SECONDS);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_TRIM_SILENCE) {
    merged.transcribe.trimSilence = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_TRIM_SILENCE);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_MIN_SILENCE_SEC) {
    merged.transcribe.minSilenceSec = Number(process.env.VIDEO_CLI_TRANSCRIBE_MIN_SILENCE_SEC);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_PAD_SEC) {
    merged.transcribe.padSec = Number(process.env.VIDEO_CLI_TRANSCRIBE_PAD_SEC);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_SILENCE_NOISE_DB) {
    merged.transcribe.silenceNoiseDb = Number(process.env.VIDEO_CLI_TRANSCRIBE_SILENCE_NOISE_DB);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_DIARIZE) {
    merged.transcribe.diarize = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_DIARIZE);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_UTTERANCES) {
    merged.transcribe.utterances = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_UTTERANCES);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_SMART_FORMAT) {
    merged.transcribe.smartFormat = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_SMART_FORMAT);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_PUNCTUATE) {
    merged.transcribe.punctuate = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_PUNCTUATE);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_DETECT_LANGUAGE) {
    merged.transcribe.detectLanguage = parseBooleanEnv(process.env.VIDEO_CLI_TRANSCRIBE_DETECT_LANGUAGE);
  }
  if (process.env.VIDEO_CLI_TRANSCRIBE_LANGUAGE) {
    merged.transcribe.language = process.env.VIDEO_CLI_TRANSCRIBE_LANGUAGE;
  }

  if (process.env.VIDEO_CLI_EMBED_PROVIDER) {
    merged.embed.provider = process.env.VIDEO_CLI_EMBED_PROVIDER;
  }
  if (process.env.VIDEO_CLI_EMBED_MODEL) {
    merged.embed.model = process.env.VIDEO_CLI_EMBED_MODEL;
  }
  if (process.env.VIDEO_CLI_EMBED_DIMENSIONS) {
    merged.embed.dimensions = Number(process.env.VIDEO_CLI_EMBED_DIMENSIONS);
  }
  if (process.env.VIDEO_CLI_EMBED_TRANSCRIPT) {
    merged.embed.sources.transcript = parseBooleanEnv(process.env.VIDEO_CLI_EMBED_TRANSCRIPT);
  }
  if (process.env.VIDEO_CLI_EMBED_OCR) {
    merged.embed.sources.ocr = parseBooleanEnv(process.env.VIDEO_CLI_EMBED_OCR);
  }
  if (process.env.VIDEO_CLI_EMBED_FRAMES) {
    merged.embed.sources.frames = parseBooleanEnv(process.env.VIDEO_CLI_EMBED_FRAMES);
  }

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
  BUILTIN_PRESETS,
  getRuntimeConfig,
};
