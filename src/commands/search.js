const { loadManifest } = require('../lib/store');
const { readArtifactJson } = require('../lib/artifacts');
const { findMatches, semanticSearch, getContext, buildChapters, findNext } = require('../lib/search');
const { embedText } = require('../lib/embed');
const { jitEnrich } = require('../lib/describe');

async function runSearch(positionals, flags, config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<query>');
  const topK = parseNumberFlag(flags, 'top', 5);

  const embeddings = readArtifactJson(id, 'embeddings.json');
  if (!embeddings || !Array.isArray(embeddings.items) || embeddings.items.length === 0) {
    throw new Error('No embeddings.json found. Run `video-cli embed` first.');
  }

  const apiKey = process.env.GEMINI_API_KEY || null;
  const queryVec = await embedText({
    apiKey,
    text: query,
    model: config.embed.model,
    taskType: config.embed.taskTypeQuery,
    dimensions: embeddings.dimensions,
  });

  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');
  const lexicalMatches = findMatches({ query, ocr, transcript });

  const matches = semanticSearch({
    query,
    queryVec,
    embeddings: embeddings.items,
    lexicalMatches,
    descriptions,
    topK,
  });

  printJson({
    id,
    query,
    matchCount: matches.length,
    matches,
  });
}

async function runContext(positionals, flags, config, { requirePositional, parseNumberFlag, parseBooleanFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const atSec = parseNumberFlag(flags, 'at', Number.NaN);
  if (!Number.isFinite(atSec)) {
    throw new Error('Missing required numeric flag: --at');
  }
  const windowSec = parseNumberFlag(flags, 'window', 10);
  const enrich = parseBooleanFlag(flags, 'enrich', true);

  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  let descriptions = readArtifactJson(id, 'descriptions.json');

  const startSec = Math.max(0, atSec - windowSec);
  const endSec = atSec + windowSec;

  if (enrich) {
    const model = (config && config.ocr && config.ocr.model) || 'gemini-3.1-flash-lite-preview';
    descriptions = await jitEnrich({ id, manifest, descriptions, startSec, endSec, model });
  }

  const context = getContext({ atSec, windowSec, transcript, ocr, descriptions, manifest });
  printJson({ id, ...context });
}

async function runChapters(positionals, _flags, _config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');

  const chapters = buildChapters({ manifest, transcript, descriptions });
  printJson({ id, durationSec: manifest.media.durationSec, chapterCount: chapters.length, chapters });
}

async function runNext(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const fromSec = parseNumberFlag(flags, 'from', Number.NaN);
  if (!Number.isFinite(fromSec)) {
    throw new Error('Missing required numeric flag: --from');
  }

  const manifest = loadManifest(id);
  const transcript = readArtifactJson(id, 'transcript.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const descriptions = readArtifactJson(id, 'descriptions.json');

  const next = findNext({ fromSec, transcript, ocr, descriptions, manifest });
  printJson({ id, fromSec, next });
}

async function runGrep(positionals, _flags, _config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<query>');
  const manifest = loadManifest(id);
  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');
  const matches = findMatches({ query, ocr, transcript });

  printJson({
    id: manifest.id,
    query,
    matchCount: matches.length,
    matches,
  });
}

module.exports = { runSearch, runContext, runChapters, runNext, runGrep };
