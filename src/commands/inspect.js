const path = require('node:path');

const {
  createArtifactPath,
  listManifests,
  loadManifest,
} = require('../lib/store');
const {
  buildEvidenceBundle,
  materializeWatchpoints,
} = require('../lib/media');
const { readArtifactJson } = require('../lib/artifacts');
const { renderBundleMarkdown } = require('../lib/render');

async function runList(_positionals, _flags, _config, { printJson }) {
  const manifests = listManifests().map(manifest => ({
    id: manifest.id,
    sourceName: manifest.sourceName,
    durationSec: manifest.media.durationSec,
    watchpointCount: manifest.watchpoints.length,
    changePointCount: manifest.sceneDetection.changePointsSec.length,
    importedAt: manifest.importedAt,
  }));
  printJson(manifests);
}

async function runStatus(positionals, _flags, _config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  const hasTranscript = !!readArtifactJson(id, 'transcript.json');
  const hasOcr = !!readArtifactJson(id, 'ocr.json');
  const hasEmbeddings = !!readArtifactJson(id, 'embeddings.json');
  const hasDescriptions = !!readArtifactJson(id, 'descriptions.json');
  const readyForAsk = hasTranscript && hasOcr && hasEmbeddings;
  const readyForSearch = hasEmbeddings;

  printJson({
    id,
    sourceName: manifest.sourceName,
    durationSec: manifest.media.durationSec,
    artifacts: {
      transcript: hasTranscript,
      ocr: hasOcr,
      embeddings: hasEmbeddings,
      descriptions: hasDescriptions,
    },
    readyForAsk,
    readyForSearch,
  });
}

async function runConfig(_positionals, _flags, config, { printJson }) {
  printJson(config);
}

async function runInspect(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);

  if (flags.timeline) {
    printJson({
      id: manifest.id,
      durationSec: manifest.media.durationSec,
      changePointsSec: manifest.sceneDetection.changePointsSec,
      watchpoints: manifest.watchpoints,
    });
    return;
  }

  if (flags.watchpoints) {
    const limit = parseNumberFlag(flags, 'limit', Number.POSITIVE_INFINITY);
    const items = Number.isFinite(limit)
      ? manifest.watchpoints.slice(0, Math.max(0, Math.floor(limit)))
      : manifest.watchpoints.slice();

    if (flags.materialize) {
      const materialized = materializeWatchpoints(manifest, items);
      printJson({ id, durationSec: manifest.media.durationSec, watchpoints: materialized });
      return;
    }

    printJson({ id, durationSec: manifest.media.durationSec, watchpoints: items });
    return;
  }

  printJson(manifest);
}

async function runTimeline(positionals, _flags, _config, { requirePositional, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const manifest = loadManifest(id);
  printJson({
    id: manifest.id,
    durationSec: manifest.media.durationSec,
    changePointsSec: manifest.sceneDetection.changePointsSec,
    watchpoints: manifest.watchpoints,
  });
}

async function runWatchpoints(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', Number.POSITIVE_INFINITY);
  const manifest = loadManifest(id);

  const items = Number.isFinite(limit)
    ? manifest.watchpoints.slice(0, Math.max(0, Math.floor(limit)))
    : manifest.watchpoints.slice();

  if (flags.materialize) {
    const materialized = materializeWatchpoints(manifest, items);
    printJson({
      id,
      durationSec: manifest.media.durationSec,
      watchpoints: materialized,
    });
    return;
  }

  printJson({
    id,
    durationSec: manifest.media.durationSec,
    watchpoints: items,
  });
}

async function runBundle(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', 8);
  const manifest = loadManifest(id);
  const bundle = buildEvidenceBundle(manifest, Math.max(1, Math.floor(limit)));
  printJson(bundle);
}

async function runBrief(positionals, flags, _config, { requirePositional, parseNumberFlag, printJson }) {
  const id = requirePositional(positionals, 0, '<video-id>');
  const limit = parseNumberFlag(flags, 'limit', 8);
  const manifest = loadManifest(id);
  const bundle = buildEvidenceBundle(manifest, Math.max(1, Math.floor(limit)));
  const output = flags.output
    ? path.resolve(String(flags.output))
    : createArtifactPath(id, '', 'brief.md');

  require('node:fs').writeFileSync(output, renderBundleMarkdown(bundle), 'utf8');
  printJson({
    id,
    output,
    watchpointCount: bundle.watchpoints.length,
  });
}

module.exports = {
  runList,
  runStatus,
  runConfig,
  runInspect,
  runTimeline,
  runWatchpoints,
  runBundle,
  runBrief,
};
