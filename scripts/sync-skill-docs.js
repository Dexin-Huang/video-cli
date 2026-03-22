const fs = require('node:fs');
const path = require('node:path');

function main(argv) {
  const repoRoot = path.resolve(__dirname, '..');
  const sourcePath = path.join(repoRoot, 'SKILL.md');
  const targetPath = path.join(repoRoot, 'skills', 'video-cli', 'SKILL.md');
  const checkOnly = argv.includes('--check');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing canonical skill doc: ${sourcePath}`);
  }
  if (!fs.existsSync(path.dirname(targetPath))) {
    throw new Error(`Missing installable skill directory: ${path.dirname(targetPath)}`);
  }

  const source = fs.readFileSync(sourcePath, 'utf8');
  const target = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;

  if (target === source) {
    console.log('skill-docs already in sync');
    return;
  }

  if (checkOnly) {
    console.error('skill-docs out of sync');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(targetPath, source, 'utf8');
  console.log(`synced ${path.relative(repoRoot, targetPath)}`);
}

main(process.argv.slice(2));
