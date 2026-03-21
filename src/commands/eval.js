const { readArtifactJson, writeArtifactJson } = require('../lib/artifacts');
const { findMatches, semanticSearch } = require('../lib/search');
const { embedText } = require('../lib/embed');
const { generateEvalQueries } = require('../lib/describe');

function calcIoU(m, gt) {
  const mStart = m.startSec ?? m.atSec ?? 0;
  const mEnd = m.endSec ?? (mStart + 5);
  const inter = Math.max(0, Math.min(mEnd, gt.endSec) - Math.max(mStart, gt.startSec));
  const union = (mEnd - mStart) + (gt.endSec - gt.startSec) - inter;
  return union > 0 ? inter / union : 0;
}

function computeBestIoU(matches, groundTruthSpans) {
  let best = { iou: 0, matchIdx: -1, spanIdx: -1 };
  for (let mi = 0; mi < matches.length; mi++) {
    for (let si = 0; si < groundTruthSpans.length; si++) {
      const iou = Number(calcIoU(matches[mi], groundTruthSpans[si]).toFixed(4));
      if (iou > best.iou) best = { iou, matchIdx: mi, spanIdx: si };
    }
  }
  return best;
}

function computeReciprocalRank(matches, groundTruthSpans, iouThreshold) {
  for (let i = 0; i < matches.length; i++) {
    for (const gt of groundTruthSpans) {
      if (calcIoU(matches[i], gt) >= iouThreshold) return Number((1 / (i + 1)).toFixed(4));
    }
  }
  return 0;
}

async function runEvalGenerate(positionals, flags, config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const model = String(flags.model || config.ocr.model);
  const apiKey = process.env.GEMINI_API_KEY || null;

  const descriptions = readArtifactJson(id, 'descriptions.json');
  const transcript = readArtifactJson(id, 'transcript.json');

  if (!descriptions) {
    throw new Error('No descriptions.json found. Run `video-cli describe` first.');
  }

  const queries = await generateEvalQueries({ apiKey, model, descriptions: descriptions.items, transcript });
  writeArtifactJson(id, 'eval-queries.json', { id, model, createdAt: new Date().toISOString(), queryCount: queries.length, queries });
  printJson({
    id, model, queryCount: queries.length,
    queries: queries.map(q => ({ query: q.query, modality: q.modality, difficulty: q.difficulty, spanCount: q.groundTruthSpans.length })),
  });
}

async function runEvalRun(positionals, flags, config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const topK = parseNumberFlag(flags, 'top', 5);
  const apiKey = process.env.GEMINI_API_KEY || null;

  const evalData = readArtifactJson(id, 'eval-queries.json');
  const embeddings = readArtifactJson(id, 'embeddings.json');
  const ocr = readArtifactJson(id, 'ocr.json');
  const transcript = readArtifactJson(id, 'transcript.json');

  if (!evalData) {
    throw new Error('No eval-queries.json found. Run `video-cli eval:generate` first.');
  }
  if (!embeddings) {
    throw new Error('No embeddings.json found. Run `video-cli embed` first.');
  }

  const results = [];

  for (const evalQuery of evalData.queries) {
    const queryVec = await embedText({
      apiKey,
      text: evalQuery.query,
      model: config.embed.model,
      taskType: config.embed.taskTypeQuery,
      dimensions: embeddings.dimensions,
    });

    const lexicalMatches = findMatches({ query: evalQuery.query, ocr, transcript });
    const matches = semanticSearch({
      query: evalQuery.query,
      queryVec,
      embeddings: embeddings.items,
      lexicalMatches,
      descriptions: null,
      topK,
    });

    const bestIoU = computeBestIoU(matches, evalQuery.groundTruthSpans);
    results.push({
      query: evalQuery.query, modality: evalQuery.modality, difficulty: evalQuery.difficulty,
      groundTruthSpans: evalQuery.groundTruthSpans, topResult: matches[0] || null,
      bestIoU: bestIoU.iou, r1_iou50: bestIoU.iou >= 0.5, r1_iou30: bestIoU.iou >= 0.3,
      reciprocalRank: computeReciprocalRank(matches, evalQuery.groundTruthSpans, 0.3),
      matchCount: matches.length,
    });
  }

  const n = Math.max(1, results.length);
  const avg = (fn) => Number((results.reduce((s, r) => s + fn(r), 0) / n).toFixed(4));
  const summary = {
    totalQueries: results.length,
    'R@1_IoU>=0.5': avg(r => r.r1_iou50 ? 1 : 0),
    'R@1_IoU>=0.3': avg(r => r.r1_iou30 ? 1 : 0),
    MRR: avg(r => r.reciprocalRank),
    meanIoU: avg(r => r.bestIoU),
  };

  writeArtifactJson(id, 'eval-results.json', { id, topK, createdAt: new Date().toISOString(), summary, results });
  printJson({
    id, summary,
    results: results.map(r => ({ query: r.query, difficulty: r.difficulty, bestIoU: r.bestIoU, r1_iou50: r.r1_iou50, rr: r.reciprocalRank })),
  });
}

module.exports = { runEvalGenerate, runEvalRun };
