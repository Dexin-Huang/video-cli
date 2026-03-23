const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(...roots) {
  for (const root of roots) {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const contents = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) {
        continue;
      }

      const key = line.slice(0, equalsIndex).trim();
      const value = stripQuotes(line.slice(equalsIndex + 1).trim());
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        continue;
      }

      process.env[key] = value;
    }
    return;
  }
}

function stripQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

module.exports = {
  loadEnvFile,
};
