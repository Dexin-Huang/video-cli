const { loadManifest } = require('../lib/store');
const { readArtifactJson } = require('../lib/artifacts');
const { findMatches, semanticSearch, getContext } = require('../lib/search');
const { embedText } = require('../lib/embed');
const { askQuestion } = require('../lib/ask');
const { jitEnrich } = require('../lib/describe');

async function runAsk(positionals, flags, config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const query = requirePositional(positionals, 1, '<question>');

  const embeddings = readArtifactJson(id, 'embeddings.json');
  if (!embeddings || !Array.isArray(embeddings.items) || embeddings.items.length === 0) {
    throw new Error('No embeddings found. Run `video-cli setup` or `video-cli embed` first.');
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
  let descriptions = readArtifactJson(id, 'descriptions.json');
  const manifest = loadManifest(id);
  const lexicalMatches = findMatches({ query, ocr, transcript });

  const searchResults = semanticSearch({
    query, queryVec, embeddings: embeddings.items,
    lexicalMatches, descriptions, topK: 5,
  });

  const topAt = searchResults[0]
    ? (searchResults[0].startSec ?? searchResults[0].atSec ?? 0)
    : 0;

  let context = null;
  if (topAt > 0 || searchResults.length > 0) {
    const startSec = Math.max(0, topAt - 10);
    const endSec = topAt + 15;
    descriptions = await jitEnrich({ id, manifest, descriptions, startSec, endSec, model: config.ocr.model });
    if (!descriptions) descriptions = readArtifactJson(id, 'descriptions.json');
    context = getContext({ atSec: topAt, windowSec: 12, transcript, ocr, descriptions, manifest });
  }

  const askModel = config.ocr.model || 'gemini-3.1-flash-lite-preview';
  const result = await askQuestion({
    apiKey, model: askModel, query, searchResults, context, videoId: id,
  });

  printJson({
    id,
    query,
    ...result,
  });
}

module.exports = { runAsk };
