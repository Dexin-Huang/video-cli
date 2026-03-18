const fs = require('node:fs');
const path = require('node:path');

const { readArtifactJson } = require('../src/lib/artifacts');
const { findMatches } = require('../src/lib/search');

function runGoldenEval(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const topK = Number.isFinite(options.topK) ? Number(options.topK) : 5;
  const manifests = loadJsonFiles(path.join(repoRoot, 'goldens', 'videos'));
  const queryCases = loadJsonFilesRecursive(path.join(repoRoot, 'goldens', 'query-cases'));
  const manifestById = new Map(manifests.map(item => [item.id, item]));
  const results = [];

  for (const queryCase of queryCases) {
    const manifest = manifestById.get(queryCase.videoId) || null;
    const artifacts = manifest?.artifactVideoId
      ? {
        ocr: readArtifactJson(manifest.artifactVideoId, 'ocr.json'),
        transcript: readArtifactJson(manifest.artifactVideoId, 'transcript.json'),
      }
      : { ocr: null, transcript: null };

    results.push(evaluateQueryCase({
      queryCase,
      manifest,
      artifacts,
      topK,
    }));
  }

  const passed = results.filter(result => result.pass).length;
  return {
    topK,
    passed,
    failed: results.length - passed,
    total: results.length,
    score: Number((passed / Math.max(1, results.length)).toFixed(3)),
    results,
  };
}

function evaluateQueryCase({ queryCase, manifest, artifacts, topK }) {
  if (!manifest) {
    return {
      id: queryCase.id,
      videoId: queryCase.videoId,
      pass: false,
      reason: 'missing manifest',
      details: null,
    };
  }

  if (!manifest.artifactVideoId) {
    return {
      id: queryCase.id,
      videoId: queryCase.videoId,
      pass: false,
      reason: 'missing artifactVideoId',
      details: null,
    };
  }

  const transcriptMatches = runSourceSearch('transcript', queryCase, artifacts).slice(0, topK);
  const ocrMatches = runSourceSearch('ocr', queryCase, artifacts).slice(0, topK);
  const spanMatch = findBestSpanMatch(transcriptMatches, queryCase.expectedSpans || [], queryCase.maxTopHitDurationSec);
  const frameMatch = findBestFrameMatch(ocrMatches, queryCase.expectedFrames || []);
  const sourceResult = evaluateExpectedSource(queryCase.expectedSource, {
    transcriptMatches,
    ocrMatches,
    spanMatch,
    frameMatch,
  });

  return {
    id: queryCase.id,
    videoId: queryCase.videoId,
    family: queryCase.family,
    pass: sourceResult.pass,
    reason: sourceResult.reason,
    details: {
      expectedSource: queryCase.expectedSource,
      transcriptQuery: queryCase.lookupQueryTranscript || queryCase.lookupQuery || queryCase.query,
      ocrQuery: queryCase.lookupQueryOcr || queryCase.lookupQuery || queryCase.query,
      spanMatch,
      frameMatch,
      transcriptMatches,
      ocrMatches,
    },
  };
}

function evaluateExpectedSource(expectedSource, context) {
  switch (expectedSource) {
    case 'transcript':
      return context.spanMatch.pass
        ? { pass: true, reason: null }
        : { pass: false, reason: 'missing transcript span match' };
    case 'clip':
      return context.spanMatch.pass
        ? { pass: true, reason: null }
        : { pass: false, reason: 'missing clip anchor span match' };
    case 'ocr':
      return context.frameMatch.pass
        ? { pass: true, reason: null }
        : { pass: false, reason: 'missing OCR frame match' };
    case 'frame':
      return context.frameMatch.pass
        ? { pass: true, reason: null }
        : { pass: false, reason: 'missing frame match' };
    case 'mixed':
      if (context.spanMatch.pass && context.frameMatch.pass) {
        return { pass: true, reason: null };
      }
      if (!context.spanMatch.pass && !context.frameMatch.pass) {
        return { pass: false, reason: 'missing transcript and OCR evidence' };
      }
      if (!context.spanMatch.pass) {
        return { pass: false, reason: 'missing transcript evidence for mixed case' };
      }
      return { pass: false, reason: 'missing OCR evidence for mixed case' };
    default:
      return { pass: false, reason: `unsupported expectedSource: ${expectedSource}` };
  }
}

function runSourceSearch(source, queryCase, artifacts) {
  const query = source === 'transcript'
    ? queryCase.lookupQueryTranscript || queryCase.lookupQuery || queryCase.query
    : queryCase.lookupQueryOcr || queryCase.lookupQuery || queryCase.query;

  if (!query) {
    return [];
  }

  if (source === 'transcript') {
    return findMatches({
      query,
      ocr: null,
      transcript: artifacts.transcript,
    }).filter(match => match.source === 'transcript');
  }

  return findMatches({
    query,
    ocr: artifacts.ocr,
    transcript: null,
  }).filter(match => match.source === 'ocr');
}

function findBestSpanMatch(matches, expectedSpans, maxDurationSec) {
  if (!expectedSpans.length) {
    return {
      pass: matches.length > 0,
      expected: [],
      actual: matches[0] || null,
    };
  }

  for (const match of matches) {
    const durationSec = Number(match.endSec) - Number(match.startSec);
    if (Number.isFinite(maxDurationSec) && durationSec > maxDurationSec) {
      continue;
    }

    for (const expected of expectedSpans) {
      if (spanMatchesExpected(match, expected)) {
        return {
          pass: true,
          expected,
          actual: match,
        };
      }
    }
  }

  return {
    pass: false,
    expected: expectedSpans,
    actual: matches[0] || null,
  };
}

function findBestFrameMatch(matches, expectedFrames) {
  if (!expectedFrames.length) {
    return {
      pass: matches.length > 0,
      expected: [],
      actual: matches[0] || null,
    };
  }

  for (const match of matches) {
    for (const expected of expectedFrames) {
      const toleranceSec = Number.isFinite(expected.toleranceSec) ? expected.toleranceSec : 1;
      if (Math.abs(Number(match.atSec) - Number(expected.atSec)) <= toleranceSec) {
        return {
          pass: true,
          expected,
          actual: match,
        };
      }
    }
  }

  return {
    pass: false,
    expected: expectedFrames,
    actual: matches[0] || null,
  };
}

function spanMatchesExpected(match, expected) {
  const toleranceSec = Number.isFinite(expected.toleranceSec) ? expected.toleranceSec : 0;
  const expectedStart = Number(expected.startSec) - toleranceSec;
  const expectedEnd = Number(expected.endSec) + toleranceSec;
  return Number(match.endSec) >= expectedStart && Number(match.startSec) <= expectedEnd;
}

function loadJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
}

function loadJsonFilesRecursive(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const items = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      items.push(...loadJsonFilesRecursive(fullPath));
      continue;
    }
    if (entry.name.endsWith('.json')) {
      items.push(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    }
  }
  return items;
}

module.exports = {
  evaluateQueryCase,
  runGoldenEval,
};
