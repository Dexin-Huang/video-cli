const test = require('node:test');
const assert = require('node:assert/strict');

const ocrFixture = require('../evals/fixtures/ocr-sample.json');
const transcriptFixture = require('../evals/fixtures/transcript-sample.json');
const { findMatches, mergeSemanticAndLexical } = require('../src/lib/search');

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

test('mergeSemanticAndLexical deduplicates and ranks by score', () => {
  const semantic = [
    { source: 'transcript', startSec: 8, score: 0.9, text: 'semantic hit' },
    { source: 'ocr', atSec: 0, score: 0.7, text: 'ocr semantic' },
  ];
  const lexical = [
    { source: 'transcript', startSec: 8, text: 'lexical hit' },
    { source: 'transcript', startSec: 30, text: 'lexical only' },
  ];
  const results = mergeSemanticAndLexical({
    semanticMatches: semantic,
    lexicalMatches: lexical,
    topK: 10,
    threshold: 0,
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].score, 0.9);
  assert.equal(results[0].source, 'transcript');
  assert.equal(results[1].score, 0.7);
  assert.equal(results[2].score, 0.5);
});

test('mergeSemanticAndLexical applies threshold and topK', () => {
  const semantic = [
    { source: 'a', atSec: 0, score: 0.8, text: 'high' },
    { source: 'b', atSec: 1, score: 0.3, text: 'low' },
    { source: 'c', atSec: 2, score: 0.1, text: 'very low' },
  ];
  const results = mergeSemanticAndLexical({
    semanticMatches: semantic,
    lexicalMatches: [],
    topK: 2,
    threshold: 0.2,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].score, 0.8);
  assert.equal(results[1].score, 0.3);
});
