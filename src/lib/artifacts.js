const fs = require('node:fs');

const { createArtifactPath } = require('./store');

function writeArtifactJson(id, fileName, value) {
  const output = createArtifactPath(id, '', fileName);
  fs.writeFileSync(output, JSON.stringify(value, null, 2));
  return output;
}

function readArtifactJson(id, fileName) {
  const artifactPath = createArtifactPath(id, '', fileName);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

module.exports = {
  readArtifactJson,
  writeArtifactJson,
};
