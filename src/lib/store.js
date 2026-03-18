const fs = require('node:fs');
const path = require('node:path');

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getDataRoot() {
  if (process.env.VIDEO_CLI_DATA_ROOT) {
    return path.resolve(process.env.VIDEO_CLI_DATA_ROOT);
  }
  return path.join(getRepoRoot(), 'data', 'videos');
}

function ensureDataRoot() {
  fs.mkdirSync(getDataRoot(), { recursive: true });
}

function getVideoDir(id) {
  return path.join(getDataRoot(), id);
}

function getManifestPath(id) {
  return path.join(getVideoDir(id), 'manifest.json');
}

function saveManifest(manifest) {
  const videoDir = getVideoDir(manifest.id);
  fs.mkdirSync(videoDir, { recursive: true });
  fs.writeFileSync(getManifestPath(manifest.id), JSON.stringify(manifest, null, 2));
}

function loadManifest(id) {
  const manifestPath = getManifestPath(id);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unknown video id: ${id}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function listManifests() {
  ensureDataRoot();
  return fs.readdirSync(getDataRoot(), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const manifestPath = getManifestPath(entry.name);
      if (!fs.existsSync(manifestPath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    })
    .filter(Boolean)
    .sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
}

function createArtifactPath(id, category, fileName) {
  const dir = path.join(getVideoDir(id), category);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

module.exports = {
  createArtifactPath,
  ensureDataRoot,
  getDataRoot,
  getRepoRoot,
  listManifests,
  loadManifest,
  saveManifest,
};


