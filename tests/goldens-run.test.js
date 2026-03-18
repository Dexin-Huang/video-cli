const test = require('node:test');
const assert = require('node:assert/strict');

const ocrFixture = require('../evals/fixtures/ocr-sample.json');
const transcriptFixture = require('../evals/fixtures/transcript-sample.json');
const { evaluateQueryCase } = require('../goldens/lib');

test('evaluateQueryCase passes a transcript span case', () => {
  const result = evaluateQueryCase({
    queryCase: {
      id: 'fixture-transcript-case',
      videoId: 'fixture-video',
      family: 'event_localization',
      query: 'find the pool c tiebreaker',
      lookupQuery: 'tiebreaker',
      expectedSource: 'transcript',
      expectedSpans: [
        {
          startSec: 8,
          endSec: 18,
          toleranceSec: 0.5,
        },
      ],
      maxTopHitDurationSec: 15,
    },
    manifest: {
      id: 'fixture-video',
      artifactVideoId: 'fixture-video',
    },
    artifacts: {
      ocr: ocrFixture,
      transcript: transcriptFixture,
    },
    topK: 5,
  });

  assert.equal(result.pass, true);
  assert.equal(result.details.spanMatch.actual.startSec, 8);
});

test('evaluateQueryCase passes a mixed frame-plus-transcript case', () => {
  const result = evaluateQueryCase({
    queryCase: {
      id: 'fixture-mixed-case',
      videoId: 'fixture-video',
      family: 'mixed_grounding',
      query: 'show the quotient formula and scoreboard',
      lookupQueryTranscript: 'defensive outs',
      lookupQueryOcr: 'scoreboard',
      expectedSource: 'mixed',
      expectedSpans: [
        {
          startSec: 24.5,
          endSec: 40,
          toleranceSec: 0.5,
        },
      ],
      expectedFrames: [
        {
          atSec: 24.5,
          toleranceSec: 0.5,
        },
      ],
      maxTopHitDurationSec: 20,
    },
    manifest: {
      id: 'fixture-video',
      artifactVideoId: 'fixture-video',
    },
    artifacts: {
      ocr: ocrFixture,
      transcript: transcriptFixture,
    },
    topK: 5,
  });

  assert.equal(result.pass, true);
  assert.equal(result.details.frameMatch.actual.atSec, 24.5);
  assert.equal(result.details.spanMatch.actual.startSec, 24.5);
});
