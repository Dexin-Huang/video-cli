const fs = require('node:fs');
const path = require('node:path');

const { runGoldenEval } = require('./lib');

main(process.argv.slice(2));

function main(argv) {
  const jsonMode = argv.includes('--json');
  const topK = parseTopK(argv);
  const repoRoot = path.resolve(__dirname, '..');
  const summary = runGoldenEval({ repoRoot, topK });
  const outputPath = path.join(repoRoot, 'goldens', 'results', 'latest.json');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary, outputPath);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function parseTopK(argv) {
  const index = argv.indexOf('--top-k');
  if (index === -1) {
    return 5;
  }
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid --top-k value: ${argv[index + 1]}`);
  }
  return Math.floor(value);
}

function printSummary(summary, outputPath) {
  const lines = [
    `Golden evals: ${summary.passed}/${summary.total} (${Math.round(summary.score * 100)}%)`,
    `Top K: ${summary.topK}`,
    `Results: ${outputPath}`,
    '',
  ];

  for (const result of summary.results) {
    lines.push(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}`);
    if (!result.pass && result.reason) {
      lines.push(`  ${result.reason}`);
    }
  }

  console.log(lines.join('\n').trim());
}
