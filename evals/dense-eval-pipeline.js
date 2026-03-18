#!/usr/bin/env node

// Dense eval pipeline: embed + describe + eval:generate for all videos with source files.
// Run: node evals/dense-eval-pipeline.js
// Skips videos that already have the required artifacts unless --force is passed.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'video-cli.js');

function run(args, label) {
  const start = Date.now();
  process.stdout.write(`  ${label}...`);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 600000,
  });

  if (result.status !== 0) {
    console.log(` FAIL (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    console.error(`    ${(result.stderr || result.stdout || '').slice(0, 200)}`);
    return null;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const output = JSON.parse(result.stdout);
  console.log(` OK (${elapsed}s)`);
  return output;
}

function hasArtifact(id, name) {
  const artifactPath = path.join(repoRoot, 'data', 'videos', id, name);
  return fs.existsSync(artifactPath);
}

const force = process.argv.includes('--force');

// Load all manifests
const listResult = spawnSync(process.execPath, [cliPath, 'list'], {
  cwd: repoRoot, encoding: 'utf8', windowsHide: true,
});
const manifests = JSON.parse(listResult.stdout);

// Filter to videos with source files
const eligible = manifests.filter(m => {
  const manifestPath = path.join(repoRoot, 'data', 'videos', m.id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return fs.existsSync(manifest.sourcePath);
});

console.log(`Found ${eligible.length} videos with source files (of ${manifests.length} total)\n`);

const summary = [];

(async () => {
  for (const video of eligible) {
    console.log(`\n=== ${video.id} (${video.sourceName}, ${(video.durationSec / 60).toFixed(1)}min) ===`);

    // Step 1: Embed (sparse)
    if (!force && hasArtifact(video.id, 'embeddings.json')) {
      console.log('  embed... SKIP (exists)');
    } else {
      run(['embed', video.id], 'embed');
    }

    // Step 2: Dense describe
    if (!force && hasArtifact(video.id, 'descriptions.json')) {
      console.log('  describe... SKIP (exists)');
    } else {
      run(['describe', video.id, '--interval', '2'], 'describe');
    }

    // Step 3: Generate eval queries
    if (!force && hasArtifact(video.id, 'eval-queries.json')) {
      console.log('  eval:generate... SKIP (exists)');
    } else {
      run(['eval:generate', video.id], 'eval:generate');
    }

    // Step 4: Run eval
    const evalResult = run(['eval:run', video.id, '--top', '5'], 'eval:run');
    if (evalResult) {
      summary.push({
        id: video.id,
        sourceName: video.sourceName,
        durationMin: Number((video.durationSec / 60).toFixed(1)),
        ...evalResult.summary,
      });
    }
  }

  console.log('\n\n=== AGGREGATE RESULTS ===\n');

  if (summary.length === 0) {
    console.log('No results.');
    return;
  }

  // Print per-video table
  const header = 'Video                              | Dur  | R@1≥.5 | R@1≥.3 | MRR    | mIoU';
  const sep =    '-----------------------------------|------|--------|--------|--------|------';
  console.log(header);
  console.log(sep);
  for (const s of summary) {
    const name = (s.sourceName || s.id).slice(0, 35).padEnd(35);
    console.log(`${name}| ${String(s.durationMin).padEnd(5)}| ${String(s['R@1_IoU>=0.5']).padEnd(7)}| ${String(s['R@1_IoU>=0.3']).padEnd(7)}| ${String(s.MRR).padEnd(7)}| ${s.meanIoU}`);
  }
  console.log(sep);

  // Aggregate
  const n = summary.length;
  const avg = (key) => Number((summary.reduce((s, r) => s + r[key], 0) / n).toFixed(4));
  console.log(`${'AVERAGE'.padEnd(35)}| ${String(summary.reduce((s,r) => s + r.durationMin, 0).toFixed(1)).padEnd(5)}| ${String(avg('R@1_IoU>=0.5')).padEnd(7)}| ${String(avg('R@1_IoU>=0.3')).padEnd(7)}| ${String(avg('MRR')).padEnd(7)}| ${avg('meanIoU')}`);

  // Save
  const resultsDir = path.join(repoRoot, 'evals', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, 'dense-eval-baseline.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), videos: summary }, null, 2)
  );
  console.log('\nSaved to evals/results/dense-eval-baseline.json');
})();
