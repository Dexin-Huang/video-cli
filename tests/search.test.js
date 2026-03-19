const test = require('node:test');
const assert = require('node:assert/strict');

const ocrFixture = require('../evals/fixtures/ocr-sample.json');
const transcriptFixture = require('../evals/fixtures/transcript-sample.json');
const { findMatches, semanticSearch, getContext, buildChapters, findNext } = require('../src/lib/search');

test('findMatches prefers utterance windows over whole transcript chunks', () => {
  const matches = findMatches({
    query: 'tiebreaker',
    ocr: ocrFixture,
    transcript: transcriptFixture,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, 'transcript');
  assert.equal(matches[0].startSec, 8);
  assert.equal(matches[0].endSec, 18);
});

test('findMatches returns OCR hits with timestamps', () => {
  const matches = findMatches({
    query: 'tokyo dome',
    ocr: ocrFixture,
    transcript: transcriptFixture,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, 'ocr');
  assert.equal(matches[0].atSec, 0);
});

test('getContext returns utterances and OCR within time window', () => {
  const context = getContext({
    atSec: 10,
    windowSec: 15,
    transcript: transcriptFixture,
    ocr: ocrFixture,
    descriptions: null,
    manifest: null,
  });

  assert.equal(context.startSec, 0);
  assert.equal(context.endSec, 25);
  assert.ok(context.utterances.length > 0);
  assert.ok(context.ocrItems.length > 0);
});

test('buildChapters creates chapters from manifest', () => {
  const manifest = {
    media: { durationSec: 100 },
    sceneDetection: { changePointsSec: [25, 50, 75] },
  };
  const chapters = buildChapters({ manifest, transcript: null, descriptions: null });
  assert.ok(chapters.length >= 2);
  assert.equal(chapters[0].startSec, 0);
  assert.equal(chapters[chapters.length - 1].endSec, 100);
});

test('findNext returns the nearest event after a timestamp', () => {
  const next = findNext({
    fromSec: 5,
    transcript: transcriptFixture,
    ocr: ocrFixture,
    descriptions: null,
    manifest: null,
  });

  assert.ok(next !== null);
  assert.ok(next.atSec > 5);
});
