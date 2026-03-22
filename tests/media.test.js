const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSceneScoreEvents, pickAdaptiveWatchpoints } = require('../src/lib/media');

test('parseSceneScoreEvents extracts timestamps and scores from ffmpeg metadata output', () => {
  const stderr = [
    '[Parsed_metadata_1 @ 0000] frame:0    pts:12800   pts_time:1',
    '[Parsed_metadata_1 @ 0000] lavfi.scene_score=0.400000',
    '[Parsed_metadata_1 @ 0000] frame:1    pts:25600   pts_time:2',
    '[Parsed_metadata_1 @ 0000] lavfi.scene_score=0.812345',
  ].join('\n');

  assert.deepEqual(parseSceneScoreEvents(stderr), [
    { atSec: 1, score: 0.4 },
    { atSec: 2, score: 0.812345 },
  ]);
});

test('pickAdaptiveWatchpoints respects maxCount even when minCount is larger', () => {
  const watchpoints = pickAdaptiveWatchpoints(120, [
    { atSec: 10, score: 0.9 },
    { atSec: 20, score: 0.8 },
    { atSec: 30, score: 0.7 },
    { atSec: 40, score: 0.6 },
    { atSec: 50, score: 0.5 },
  ], {
    minCount: 8,
    maxCount: 4,
    minGapSec: 0,
  });

  assert.equal(watchpoints.length, 4);
});
