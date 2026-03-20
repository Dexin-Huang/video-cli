const { readArtifactJson, writeArtifactJson } = require('../lib/artifacts');
const { findMatches, semanticSearch } = require('../lib/search');
const { embedText } = require('../lib/embed');
const { generateEvalQueries } = require('../lib/describe');

function computeBestIoU(matches, groundTruthSpans) {
  let best = { iou: 0, matchIdx: -1, spanIdx: -1 };

  for (let mi = 0; mi < matches.length; mi += 1) {
    const m = matches[mi];
    const mStart = m.startSec ?? m.atSec ?? 0;
    const mEnd = m.endSec ?? (mStart + 5);

    for (let si = 0; si < groundTruthSpans.length; si += 1) {
      const gt = groundTruthSpans[si];
      const interStart = Math.max(mStart, gt.startSec);
      const interEnd = Math.min(mEnd, gt.endSec);
      const intersection = Math.max(0, interEnd - interStart);
      const union = (mEnd - mStart) + (gt.endSec - gt.startSec) - intersection;
      const iou = union > 0 ? Number((intersection / union).toFixed(4)) : 0;

      if (iou > best.iou) {
        best = { iou, matchIdx: mi, spanIdx: si };
      }
    }
  }

  return best;
}

function computeReciprocalRank(matches, groundTruthSpans, iouThreshold) {
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const mStart = m.startSec ?? m.atSec ?? 0;
    const mEnd = m.endSec ?? (mStart + 5);

    for (const gt of groundTruthSpans) {
      const interStart = Math.max(mStart, gt.startSec);
      const interEnd = Math.min(mEnd, gt.endSec);
      const intersection = Math.max(0, interEnd - interStart);
      const union = (mEnd - mStart) + (gt.endSec - gt.startSec) - intersection;
      const iou = union > 0 ? intersection / union : 0;

      if (iou >= iouThreshold) {
        return Number((1 / (i + 1)).toFixed(4));
      }
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

  const queries = await generateEvalQueries({
    apiKey,
    model,
    descriptions: descriptions.items,
    transcript,
  });

  const payload = {
    id,
    model,
    createdAt: new Date().toISOString(),
    queryCount: queries.length,
    queries,
  };

  writeArtifactJson(id, 'eval-queries.json', payload);
  printJson({
    id,
    model,
    queryCount: queries.length,
    queries: queries.map(q => ({
      query: q.query,
      modality: q.modality,
      difficulty: q.difficulty,
      spanCount: q.groundTruthSpans.length,
    })),
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
    const r1Hit = bestIoU.iou >= 0.5;
    const r1Loose = bestIoU.iou >= 0.3;

    const reciprocalRank = computeReciprocalRank(matches, evalQuery.groundTruthSpans, 0.3);

    results.push({
      query: evalQuery.query,
      modality: evalQuery.modality,
      difficulty: evalQuery.difficulty,
      groundTruthSpans: evalQuery.groundTruthSpans,
      topResult: matches[0] || null,
      bestIoU: bestIoU.iou,
      r1_iou50: r1Hit,
      r1_iou30: r1Loose,
      reciprocalRank,
      matchCount: matches.length,
    });
  }

  const totalQueries = results.length;
  const r1_50 = results.filter(r => r.r1_iou50).length / Math.max(1, totalQueries);
  const r1_30 = results.filter(r => r.r1_iou30).length / Math.max(1, totalQueries);
  const mrr = results.reduce((s, r) => s + r.reciprocalRank, 0) / Math.max(1, totalQueries);
  const meanIoU = results.reduce((s, r) => s + r.bestIoU, 0) / Math.max(1, totalQueries);

  const payload = {
    id,
    topK,
    createdAt: new Date().toISOString(),
    summary: {
      totalQueries,
      'R@1_IoU>=0.5': Number(r1_50.toFixed(4)),
      'R@1_IoU>=0.3': Number(r1_30.toFixed(4)),
      MRR: Number(mrr.toFixed(4)),
      meanIoU: Number(meanIoU.toFixed(4)),
    },
    results,
  };

  writeArtifactJson(id, 'eval-results.json', payload);
  printJson({
    id,
    summary: payload.summary,
    results: results.map(r => ({
      query: r.query,
      difficulty: r.difficulty,
      bestIoU: r.bestIoU,
      r1_iou50: r.r1_iou50,
      rr: r.reciprocalRank,
    })),
  });
}

module.exports = { runEvalGenerate, runEvalRun };
