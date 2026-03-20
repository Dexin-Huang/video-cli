const fs = require('node:fs');

const { loadManifest } = require('../lib/store');
const { readArtifactJson, writeArtifactJson } = require('../lib/artifacts');
const { findMatches, semanticSearch, getContext } = require('../lib/search');
const { embedText } = require('../lib/embed');
const { askQuestion } = require('../lib/ask');

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

  // Gather context around the top result
  const topAt = searchResults[0]
    ? (searchResults[0].startSec ?? searchResults[0].atSec ?? 0)
    : 0;

  let context = null;
  if (topAt > 0 || searchResults.length > 0) {
    // JIT enrich if source exists and no descriptions for this window
    const startSec = Math.max(0, topAt - 10);
    const endSec = topAt + 15;

    if (manifest.sourcePath && fs.existsSync(manifest.sourcePath)) {
      const hasCoverage = descriptions && Array.isArray(descriptions.items) &&
        descriptions.items.some(d => d.atSec >= startSec && d.atSec <= endSec);
      if (!hasCoverage) {
        const { enrichRegion } = require('../lib/describe');
        const descModel = config.ocr.model || 'gemini-3.1-flash-lite-preview';
        const newItems = await enrichRegion({
          apiKey, model: descModel,
          sourcePath: manifest.sourcePath, videoId: id,
          startSec, endSec, intervalSec: 2,
          existingDescriptions: descriptions,
        });
        if (newItems.length > 0) {
          const desc = descriptions || { id, model: descModel, intervalSec: 2, createdAt: new Date().toISOString(), frameCount: 0, items: [] };
          desc.items.push(...newItems);
          desc.items.sort((a, b) => a.atSec - b.atSec);
          desc.frameCount = desc.items.length;
          writeArtifactJson(id, 'descriptions.json', desc);
        }
      }
    }

    // Re-read only if enrichment wrote new items, otherwise use what we have
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
