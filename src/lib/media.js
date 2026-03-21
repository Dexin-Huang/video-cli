const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createArtifactPath } = require('./store');

function getFileIdentity(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
    idSeed: `${filePath}|${stats.size}|${stats.mtimeMs}`,
  };
}

function buildVideoId(identity) {
  const base = path.basename(identity.path, path.extname(identity.path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'video';
  const hash = crypto.createHash('sha1').update(identity.idSeed).digest('hex').slice(0, 10);
  return `${base}-${hash}`;
}

function probeVideo(filePath) {
  const result = runProcess('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  return JSON.parse(result.stdout);
}

function detectSceneChanges(filePath, threshold) {
  return detectSceneChangesWithScores(filePath, threshold).map(e => e.atSec);
}

function detectSceneChangesWithScores(filePath, threshold) {
  const t = threshold || 0.35;
  const nullSink = os.platform() === 'win32' ? 'NUL' : '/dev/null';
  const result = runProcess('ffmpeg', [
    '-hide_banner', '-i', filePath,
    '-filter:v', `select='gt(scene,${t})',showinfo`,
    '-vsync', 'vfr', '-f', 'null', nullSink,
  ], { allowFailure: true });

  const seen = new Set();
  const entries = [];
  for (const m of (result.stderr || '').matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const atSec = Number(Number(m[1]).toFixed(3));
    if (!Number.isFinite(atSec)) continue;
    const key = atSec.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ atSec, score: t });
  }
  return entries.sort((a, b) => a.atSec - b.atSec);
}

function pickAdaptiveWatchpoints(durationSec, sceneScores, options = {}) {
  const minCount = options.minCount || Math.max(6, Math.ceil(durationSec / 30));
  const maxCount = options.maxCount || Math.max(minCount, Math.ceil(durationSec / 15));
  const sigmaMultiplier = options.sigmaMultiplier || 1.0;
  const minGapSec = options.minGapSec || 3;

  const byKey = new Map();

  const add = (atSec, kind, reason, score) => {
    if (!Number.isFinite(atSec) || atSec < 0) return;
    const bounded = durationSec > 0 ? Math.min(atSec, durationSec) : atSec;
    const key = bounded.toFixed(3);
    if (!byKey.has(key)) {
      byKey.set(key, { atSec: Number(key), kind, reason, score: score || 0 });
    }
  };

  // Always include anchors
  add(0, 'anchor', 'start', 0);
  if (durationSec > 0) {
    add(durationSec / 2, 'anchor', 'middle', 0);
    add(Math.max(durationSec - 0.01, 0), 'anchor', 'end', 0);
  }

  if (sceneScores.length > 0) {
    // Self-normalized: pick outliers relative to this video's own distribution
    const scores = sceneScores.map(e => e.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) || 0.01;
    const threshold = mean + sigmaMultiplier * std;

    // Add all frames above the relative threshold
    for (const entry of sceneScores) {
      if (entry.score >= threshold) {
        add(entry.atSec, 'scene', 'relative-outlier', entry.score);
      }
    }
  }

  // If we don't have enough, fill with uniform coverage
  let items = Array.from(byKey.values()).sort((a, b) => a.atSec - b.atSec);
  if (items.length < minCount && durationSec > 0) {
    const needed = minCount - items.length;
    for (let i = 1; i <= needed; i += 1) {
      const frac = i / (needed + 1);
      add(durationSec * frac, 'uniform', 'coverage', 0);
    }
    items = Array.from(byKey.values()).sort((a, b) => a.atSec - b.atSec);
  }

  // Enforce minimum gap between watchpoints
  if (minGapSec > 0 && items.length > maxCount) {
    const filtered = [items[0]];
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].atSec - filtered[filtered.length - 1].atSec >= minGapSec) {
        filtered.push(items[i]);
      }
    }
    items = filtered;
  }

  // Cap at maxCount, keeping highest-score items
  if (items.length > maxCount) {
    items.sort((a, b) => b.score - a.score);
    const kept = items.slice(0, maxCount);
    kept.sort((a, b) => a.atSec - b.atSec);
    items = kept;
  }

  return items;
}

function pickWatchpoints(durationSec, changePointsSec, requestedCount) {
  const maxCount = Math.max(3, Math.min(24, Math.floor(requestedCount || 12)));
  const byKey = new Map();

  const add = (atSec, kind, reason) => {
    if (!Number.isFinite(atSec) || atSec < 0) {
      return;
    }
    const bounded = durationSec > 0 ? Math.min(atSec, durationSec) : atSec;
    const key = bounded.toFixed(3);
    if (!byKey.has(key)) {
      byKey.set(key, {
        atSec: Number(key),
        kind,
        reason,
      });
    }
  };

  add(0, 'anchor', 'start');
  if (durationSec > 0) {
    add(durationSec / 2, 'anchor', 'middle');
    add(Math.max(durationSec - 0.01, 0), 'anchor', 'end');
  }

  for (const point of changePointsSec) {
    add(point, 'scene', 'scene-change');
  }

  const current = Array.from(byKey.values()).sort((left, right) => left.atSec - right.atSec);
  const remainingSlots = maxCount - current.length;

  if (durationSec > 0 && remainingSlots > 0) {
    for (let index = 1; index <= remainingSlots; index += 1) {
      const fraction = index / (remainingSlots + 1);
      add(durationSec * fraction, 'uniform', 'coverage');
    }
  }

  let items = Array.from(byKey.values()).sort((left, right) => left.atSec - right.atSec);
  if (items.length <= maxCount) {
    return items;
  }

  const kept = new Map();
  kept.set(items[0].atSec.toFixed(3), items[0]);
  if (items.length > 1) {
    const interiorCount = maxCount - 2;
    for (let index = 1; index <= interiorCount; index += 1) {
      const pos = Math.round((index * (items.length - 1)) / (interiorCount + 1));
      kept.set(items[pos].atSec.toFixed(3), items[pos]);
    }
    kept.set(items[items.length - 1].atSec.toFixed(3), items[items.length - 1]);
  }
  return Array.from(kept.values()).sort((a, b) => a.atSec - b.atSec);
}

function extractFrame(sourcePath, atSec, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  runProcess('ffmpeg', [
    '-y',
    '-ss', String(atSec),
    '-i', sourcePath,
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ]);
}

function extractAudioChunk(sourcePath, startSec, durationSec, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  runProcess('ffmpeg', [
    '-y',
    '-ss', String(startSec),
    '-i', sourcePath,
    '-t', String(durationSec),
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '32k',
    outputPath,
  ]);
}

function detectSilences(sourcePath, startSec, durationSec, options = {}) {
  const minSilenceSec = Number.isFinite(options.minSilenceSec) ? options.minSilenceSec : 1.5;
  const silenceNoiseDb = Number.isFinite(options.silenceNoiseDb) ? options.silenceNoiseDb : -35;
  const nullSink = os.platform() === 'win32' ? 'NUL' : '/dev/null';
  const filter = `silencedetect=n=${silenceNoiseDb}dB:d=${minSilenceSec}`;

  const args = [
    '-hide_banner',
    '-ss', String(startSec),
    '-i', sourcePath,
    '-t', String(durationSec),
    '-vn',
    '-af', filter,
    '-f', 'null',
    nullSink,
  ];

  const result = runProcess('ffmpeg', args, { allowFailure: true });
  return parseSilenceEvents(result.stderr, durationSec);
}

function buildSpeechSegments(startSec, endSec, silences, options = {}) {
  const durationSec = Math.max(0, endSec - startSec);
  const padSec = Number.isFinite(options.padSec) ? Math.max(0, options.padSec) : 0.25;
  const mergeGapSec = Number.isFinite(options.mergeGapSec) ? Math.max(0, options.mergeGapSec) : 0.35;
  const silentRanges = (silences || [])
    .filter(item => Number.isFinite(item.startSec) && Number.isFinite(item.endSec) && item.endSec > item.startSec)
    .slice()
    .sort((left, right) => left.startSec - right.startSec);

  const speechRanges = [];
  let cursor = 0;
  for (const silence of silentRanges) {
    const ss = Math.max(0, Math.min(durationSec, silence.startSec));
    const se = Math.max(ss, Math.min(durationSec, silence.endSec));
    if (ss > cursor) speechRanges.push({ startSec: cursor, endSec: ss });
    cursor = Math.max(cursor, se);
  }
  if (cursor < durationSec) speechRanges.push({ startSec: cursor, endSec: durationSec });

  const padded = speechRanges
    .map(r => ({ startSec: Math.max(0, r.startSec - padSec), endSec: Math.min(durationSec, r.endSec + padSec) }))
    .filter(r => r.endSec - r.startSec > 0.05);

  const merged = [];
  for (const r of padded) {
    const prev = merged[merged.length - 1];
    if (prev && r.startSec - prev.endSec <= mergeGapSec) { prev.endSec = Math.max(prev.endSec, r.endSec); }
    else merged.push({ ...r });
  }

  return merged.map(r => ({
    startSec: roundToMillis(startSec + r.startSec),
    endSec: roundToMillis(startSec + r.endSec),
    durationSec: roundToMillis(r.endSec - r.startSec),
  }));
}

function extractClip(manifest, atSec, preSec, postSec, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const hasAudio = !!manifest.media.audio;
  const args = [
    '-y', '-ss', String(Math.max(0, atSec - preSec)),
    '-i', manifest.sourcePath, '-t', String(Math.max(0.1, preSec + postSec)),
    '-map', '0:v:0?', ...(hasAudio ? ['-map', '0:a:0?'] : ['-an']),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac'] : []), outputPath,
  ];
  runProcess('ffmpeg', args);
}

function materializeWatchpoints(manifest, watchpoints) {
  return watchpoints.map(item => {
    const output = createArtifactPath(
      manifest.id,
      'watchpoints',
      `watchpoint-${String(item.atSec.toFixed(3)).replace('.', '_')}.jpg`
    );

    if (!fs.existsSync(output)) {
      extractFrame(manifest.sourcePath, item.atSec, output);
    }

    return {
      ...item,
      framePath: output,
    };
  });
}

function buildEvidenceBundle(manifest, limit) {
  const selected = manifest.watchpoints.slice(0, limit);
  const materialized = materializeWatchpoints(manifest, selected);
  const watchpoints = addCoverageWindows(materialized, manifest.media.durationSec);

  return {
    id: manifest.id,
    sourceName: manifest.sourceName,
    sourcePath: manifest.sourcePath,
    durationSec: manifest.media.durationSec,
    sceneChangeCount: manifest.sceneDetection.changePointsSec.length,
    watchpoints,
    suggestedQuestions: [
      'What happens over the full arc of the video?',
      'Which watchpoints seem visually important or repeated?',
      'Which neighboring windows should be clipped for more detail?',
    ],
  };
}

function addCoverageWindows(watchpoints, durationSec) {
  return watchpoints.map((item, index) => {
    const previous = watchpoints[index - 1];
    const next = watchpoints[index + 1];
    const windowStartSec = previous ? roundToMillis((previous.atSec + item.atSec) / 2) : 0;
    const windowEndSec = next
      ? roundToMillis((item.atSec + next.atSec) / 2)
      : roundToMillis(durationSec);

    return {
      ...item,
      windowStartSec,
      windowEndSec,
    };
  });
}

function roundToMillis(value) {
  return Number(value.toFixed(3));
}

function parseSilenceEvents(stderr, durationSec) {
  const silences = [];
  const lines = String(stderr || '').split(/\r?\n/);
  let pendingStartSec = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (startMatch) {
      pendingStartSec = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!endMatch) {
      continue;
    }

    const endSec = Number(endMatch[1]);
    const fallbackStartSec = Math.max(0, endSec - Number(endMatch[2]));
    const startSec = pendingStartSec === null ? fallbackStartSec : pendingStartSec;
    pendingStartSec = null;

    const boundedStartSec = roundToMillis(Math.max(0, Math.min(durationSec, startSec)));
    const boundedEndSec = roundToMillis(Math.max(boundedStartSec, Math.min(durationSec, endSec)));
    if (boundedEndSec <= boundedStartSec) {
      continue;
    }

    silences.push({
      startSec: boundedStartSec,
      endSec: boundedEndSec,
      durationSec: roundToMillis(boundedEndSec - boundedStartSec),
    });
  }

  if (pendingStartSec !== null && durationSec > pendingStartSec) {
    const boundedStartSec = roundToMillis(Math.max(0, Math.min(durationSec, pendingStartSec)));
    const boundedEndSec = roundToMillis(durationSec);
    silences.push({
      startSec: boundedStartSec,
      endSec: boundedEndSec,
      durationSec: roundToMillis(boundedEndSec - boundedStartSec),
    });
  }

  return silences;
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`${command} not found. Is ${command} installed and on PATH?`);
    }
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const details = result.stderr || result.stdout || `Exit code ${result.status}`;
    throw new Error(`${command} failed. Is ${command} installed and on PATH? Details: ${details.trim()}`);
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

module.exports = {
  buildEvidenceBundle,
  buildSpeechSegments,
  buildVideoId,
  detectSilences,
  detectSceneChanges,
  detectSceneChangesWithScores,
  extractAudioChunk,
  extractClip,
  extractFrame,
  getFileIdentity,
  materializeWatchpoints,
  pickAdaptiveWatchpoints,
  pickWatchpoints,
  probeVideo,
};
