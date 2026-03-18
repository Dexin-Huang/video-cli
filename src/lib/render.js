const path = require('node:path');

function renderBundleMarkdown(bundle) {
  const lines = [
    '# Video Brief',
    '',
    `- id: \`${bundle.id}\``,
    `- source: \`${bundle.sourceName}\``,
    `- source path: \`${bundle.sourcePath}\``,
    `- duration: ${bundle.durationSec.toFixed(3)}s`,
    `- scene changes: ${bundle.sceneChangeCount}`,
    '',
    '## Watchpoints',
    '',
  ];

  bundle.watchpoints.forEach((item, index) => {
    const frameLabel = relativeFramePath(item.framePath);
    lines.push(`### ${index + 1}. ${item.kind} @ ${item.atSec.toFixed(3)}s`);
    lines.push('');
    lines.push(`- reason: ${item.reason}`);
    lines.push(`- interval: ${item.windowStartSec.toFixed(3)}s to ${item.windowEndSec.toFixed(3)}s`);
    lines.push(`- frame: \`${frameLabel}\``);
    lines.push(`- inspect frame: \`video-cli frame ${bundle.id} --at ${item.atSec.toFixed(3)}\``);
    lines.push(`- inspect clip: \`video-cli clip ${bundle.id} --at ${item.atSec.toFixed(3)} --pre 3 --post 3\``);
    lines.push('');
  });

  lines.push('## Suggested Questions');
  lines.push('');
  bundle.suggestedQuestions.forEach(question => {
    lines.push(`- ${question}`);
  });

  return lines.join('\n');
}

function relativeFramePath(framePath) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  return path.relative(repoRoot, framePath).replace(/\\/g, '/');
}

module.exports = {
  renderBundleMarkdown,
};

