const test = require('node:test');
const assert = require('node:assert/strict');

const ocrFixture = require('../evals/fixtures/ocr-sample.json');
const transcriptFixture = require('../evals/fixtures/transcript-sample.json');
const { findMatches } = require('../src/lib/search');

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
