const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_QUERY_FAMILIES = new Set([
  'transcript_exact',
  'transcript_paraphrase',
  'event_localization',
  'before_after_context',
  'ocr_exact',
  'visual_state',
  'mixed_grounding',
]);

main(process.argv.slice(2));

function main(argv) {
  const repoRoot = path.resolve(__dirname, '..');
  const setPath = path.join(repoRoot, 'goldens', 'sets', 'mixed-15.json');
  const jsonMode = argv.includes('--json');
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  const checks = [];
  const manifestFiles = readJsonFiles(path.join(repoRoot, 'goldens', 'videos'));
  const queryCaseFiles = readJsonFilesRecursive(path.join(repoRoot, 'goldens', 'query-cases'));
  const customVideoIds = (set.videos || [])
    .filter(video => video.sourceDataset === 'custom')
    .map(video => video.id);

  addCheck(checks, 'set has a name', typeof set.name === 'string' && set.name.length > 0, {
    name: set.name || null,
  });
  addCheck(checks, 'set declares the north star', typeof set.northStar === 'string' && set.northStar.includes('searchable'), {
    northStar: set.northStar || null,
  });
  addCheck(checks, 'set contains 15 selected videos', Array.isArray(set.videos) && set.videos.length === 15, {
    totalVideos: Array.isArray(set.videos) ? set.videos.length : 0,
  });

  const counts = countByDataset(set.videos || []);
  addCheck(checks, 'YouCook2 count matches target', counts.YouCook2 === set.targetCounts.YouCook2, {
    actual: counts.YouCook2,
    expected: set.targetCounts.YouCook2,
  });
  addCheck(checks, 'ActivityNetCaptions count matches target', counts.ActivityNetCaptions === set.targetCounts.ActivityNetCaptions, {
    actual: counts.ActivityNetCaptions,
    expected: set.targetCounts.ActivityNetCaptions,
  });
  addCheck(checks, 'custom count matches target', counts.custom === set.targetCounts.custom, {
    actual: counts.custom,
    expected: set.targetCounts.custom,
  });

  const perVideoChecks = (set.videos || []).map(validateVideo);
  const failedVideos = perVideoChecks.filter(item => !item.pass);
  addCheck(checks, 'every video slot has required structure', failedVideos.length === 0, {
    failedVideos,
  });

  const customCoverage = summarizeCustomCoverage(set.videos || []);
  addCheck(checks, 'custom videos cover OCR-heavy product cases', customCoverage.pass, customCoverage.details);
  addCheck(
    checks,
    'custom video manifests exist for each custom selection',
    customVideoIds.every(id => manifestFiles.some(file => file.data?.id === id)),
    {
      present: manifestFiles.map(file => file.data?.id).filter(Boolean),
      expected: customVideoIds,
    }
  );

  const invalidManifestFiles = manifestFiles
    .map(file => validateManifest(file))
    .filter(item => !item.pass);
  addCheck(checks, 'grounded manifest files are structurally valid', invalidManifestFiles.length === 0, {
    failedManifests: invalidManifestFiles,
  });

  const invalidQueryCases = queryCaseFiles
    .map(file => validateQueryCase(file))
    .filter(item => !item.pass);
  addCheck(checks, 'starter query cases are structurally valid', invalidQueryCases.length === 0, {
    failedQueryCases: invalidQueryCases,
  });

  const queryCoverage = summarizeQueryCoverage(manifestFiles, queryCaseFiles);
  addCheck(checks, 'each grounded manifest has starter query coverage', queryCoverage.pass, queryCoverage.details);

  const summary = {
    set: set.name,
    passed: checks.filter(check => check.pass).length,
    total: checks.length,
    score: Number((checks.filter(check => check.pass).length / Math.max(1, checks.length)).toFixed(3)),
    checks,
  };

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }

  if (summary.passed !== summary.total) {
    process.exitCode = 1;
  }
}

function validateVideo(video) {
  const reasons = [];
  if (!video || typeof video !== 'object') {
    return { id: null, pass: false, reasons: ['video is not an object'] };
  }
  if (!isNonEmptyString(video.id)) {
    reasons.push('missing id');
  }
  if (!isNonEmptyString(video.title)) {
    reasons.push('missing title');
  }
  if (!isNonEmptyString(video.status)) {
    reasons.push('missing status');
  }
  if (!isNonEmptyString(video.sourceType)) {
    reasons.push('missing sourceType');
  }
  if (!isNonEmptyString(video.sourceDataset)) {
    reasons.push('missing sourceDataset');
  }
  if (!isNonEmptyString(video.sourceRef)) {
    reasons.push('missing sourceRef');
  }
  if (!Number.isFinite(video.durationSec)) {
    reasons.push('missing durationSec');
  }
  if (!Array.isArray(video.modalityFocus) || video.modalityFocus.length === 0) {
    reasons.push('missing modalityFocus');
  }
  if (!Array.isArray(video.requiredQueryFamilies) || video.requiredQueryFamilies.length < 4) {
    reasons.push('needs at least 4 query families');
  } else {
    const unknown = video.requiredQueryFamilies.filter(item => !REQUIRED_QUERY_FAMILIES.has(item));
    if (unknown.length > 0) {
      reasons.push(`unknown query families: ${unknown.join(', ')}`);
    }
  }

  return {
    id: video.id || null,
    pass: reasons.length === 0,
    reasons,
  };
}

function validateManifest(file) {
  const video = file.data;
  const reasons = [];

  if (!video || typeof video !== 'object') {
    reasons.push('manifest is not an object');
  } else {
    if (!isNonEmptyString(video.id)) {
      reasons.push('missing id');
    }
    if (!isNonEmptyString(video.title)) {
      reasons.push('missing title');
    }
    if (!isNonEmptyString(video.status)) {
      reasons.push('missing status');
    }
    if (!isNonEmptyString(video.sourceType)) {
      reasons.push('missing sourceType');
    }
    if (!isNonEmptyString(video.sourceDataset)) {
      reasons.push('missing sourceDataset');
    }
    if (!Number.isFinite(video.durationSec)) {
      reasons.push('missing durationSec');
    }
    if (!Array.isArray(video.modalityFocus) || video.modalityFocus.length === 0) {
      reasons.push('missing modalityFocus');
    }
    if (!Array.isArray(video.requiredQueryFamilies) || video.requiredQueryFamilies.length < 4) {
      reasons.push('needs at least 4 query families');
    }
    if (!isNonEmptyString(video.sourceRef)) {
      reasons.push('missing sourceRef');
    }
    if (!isNonEmptyString(video.artifactVideoId)) {
      reasons.push('missing artifactVideoId');
    }
    if (video.sourceType === 'custom' && video.sourceDataset !== 'custom') {
      reasons.push('custom manifest sourceDataset must be custom');
    }
  }

  return {
    path: file.path,
    id: video?.id || null,
    pass: reasons.length === 0,
    reasons,
  };
}

function validateQueryCase(file) {
  const queryCase = file.data;
  const reasons = [];

  if (!queryCase || typeof queryCase !== 'object') {
    reasons.push('query case is not an object');
  } else {
    if (!isNonEmptyString(queryCase.id)) {
      reasons.push('missing id');
    }
    if (!isNonEmptyString(queryCase.videoId)) {
      reasons.push('missing videoId');
    }
    if (!REQUIRED_QUERY_FAMILIES.has(queryCase.family)) {
      reasons.push(`invalid family: ${queryCase.family}`);
    }
    if (!isNonEmptyString(queryCase.query)) {
      reasons.push('missing query');
    }
    if (!isNonEmptyString(queryCase.expectedSource)) {
      reasons.push('missing expectedSource');
    }
    if (queryCase.expectedSpans && !isValidSpanList(queryCase.expectedSpans)) {
      reasons.push('invalid expectedSpans');
    }
    if (queryCase.expectedFrames && !isValidFrameList(queryCase.expectedFrames)) {
      reasons.push('invalid expectedFrames');
    }
  }

  return {
    path: file.path,
    id: queryCase?.id || null,
    videoId: queryCase?.videoId || null,
    pass: reasons.length === 0,
    reasons,
  };
}

function summarizeCustomCoverage(videos) {
  const customVideos = videos.filter(video => video.sourceDataset === 'custom');
  const notes = customVideos.map(video => String(video.notes || '').toLowerCase());
  const pass = (
    notes.some(note => note.includes('scoreboard') || note.includes('broadcast')) &&
    notes.some(note => note.includes('slides') || note.includes('whiteboard') || note.includes('chart')) &&
    notes.some(note => note.includes('ui walkthrough') || note.includes('screen recording') || note.includes('code'))
  );

  return {
    pass,
    details: {
      customVideoCount: customVideos.length,
      notes: customVideos.map(video => ({
        id: video.id,
        notes: video.notes,
      })),
    },
  };
}

function countByDataset(videos) {
  return videos.reduce((counts, video) => {
    const key = video.sourceDataset;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {
    YouCook2: 0,
    ActivityNetCaptions: 0,
    custom: 0,
  });
}

function summarizeQueryCoverage(manifestFiles, queryCaseFiles) {
  const groundedManifests = manifestFiles
    .map(file => file.data)
    .filter(item => item && item.annotationStatus === 'grounded-local-artifacts');
  const casesByVideo = new Map();
  for (const manifest of groundedManifests) {
    casesByVideo.set(manifest.id, []);
  }

  for (const file of queryCaseFiles) {
    const item = file.data;
    if (!item || !casesByVideo.has(item.videoId)) {
      continue;
    }
    casesByVideo.get(item.videoId).push(item);
  }

  const details = groundedManifests.map(manifest => {
    const id = manifest.id;
    const items = casesByVideo.get(id) || [];
    const families = [...new Set(items.map(item => item.family))];
    return {
      id,
      queryCaseCount: items.length,
      families,
      requiredFamilies: manifest.requiredQueryFamilies || [],
    };
  });

  return {
    pass: details.every(item =>
      item.queryCaseCount >= 4 &&
      (item.requiredFamilies || []).every(family => item.families.includes(family))
    ),
    details,
  };
}

function addCheck(checks, name, pass, details) {
  checks.push({
    name,
    pass: Boolean(pass),
    details: details || null,
  });
}

function printSummary(summary) {
  const lines = [
    `Golden set: ${summary.set}`,
    `Score: ${summary.passed}/${summary.total} (${Math.round(summary.score * 100)}%)`,
    '',
  ];

  for (const check of summary.checks) {
    lines.push(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
    if (check.details) {
      lines.push(`  ${JSON.stringify(check.details)}`);
    }
  }

  console.log(lines.join('\n').trim());
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSpanList(value) {
  return Array.isArray(value) && value.every(item =>
    item &&
    Number.isFinite(item.startSec) &&
    Number.isFinite(item.endSec) &&
    (!('toleranceSec' in item) || Number.isFinite(item.toleranceSec))
  );
}

function isValidFrameList(value) {
  return Array.isArray(value) && value.every(item =>
    item &&
    Number.isFinite(item.atSec) &&
    (!('toleranceSec' in item) || Number.isFinite(item.toleranceSec))
  );
}

function readJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const filePath = path.join(directory, name);
      return {
        path: filePath,
        data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      };
    });
}

function readJsonFilesRecursive(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const items = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      items.push(...readJsonFilesRecursive(filePath));
      continue;
    }
    if (entry.name.endsWith('.json')) {
      items.push({
        path: filePath,
        data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      });
    }
  }
  return items;
}
