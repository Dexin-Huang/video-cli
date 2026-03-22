const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEmbeddings, cosineSimilarity, embedText, rankBySimilarity } = require('../src/lib/embed');

test('cosineSimilarity returns 1 for parallel vectors', () => {
  const a = [1, 2, 3];
  const b = [2, 4, 6];
  assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-10);
});

test('cosineSimilarity returns -1 for anti-parallel vectors', () => {
  const a = [1, 2, 3];
  const b = [-1, -2, -3];
  assert.ok(Math.abs(cosineSimilarity(a, b) - (-1.0)) < 1e-10);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-10);
});

test('cosineSimilarity returns 0 for zero vector', () => {
  const a = [0, 0, 0];
  const b = [1, 2, 3];
  assert.equal(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity returns 0 for mismatched lengths', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
});

test('rankBySimilarity returns correct order', () => {
  const query = [1, 0, 0];
  const items = [
    { source: 'a', index: 0, vector: [0, 1, 0], text: 'miss' },
    { source: 'b', index: 1, vector: [1, 0, 0], text: 'exact' },
    { source: 'c', index: 2, vector: [0.7, 0.7, 0], text: 'partial' },
  ];
  const results = rankBySimilarity(query, items, 10);
  assert.equal(results[0].text, 'exact');
  assert.equal(results[1].text, 'partial');
  assert.equal(results[2].text, 'miss');
});

test('rankBySimilarity respects topK limit', () => {
  const query = [1, 0];
  const items = [
    { source: 'a', index: 0, vector: [1, 0], text: 'first' },
    { source: 'b', index: 1, vector: [0, 1], text: 'second' },
    { source: 'c', index: 2, vector: [0.5, 0.5], text: 'third' },
  ];
  const results = rankBySimilarity(query, items, 2);
  assert.equal(results.length, 2);
});

test('mock embedText returns deterministic vectors', async () => {
  process.env.VIDEO_CLI_MOCK_GEMINI = '1';
  try {
    const v1 = await embedText({ text: 'hello world', dimensions: 32 });
    const v2 = await embedText({ text: 'hello world', dimensions: 32 });
    const v3 = await embedText({ text: 'different text', dimensions: 32 });

    assert.equal(v1.length, 32);
    assert.deepEqual(v1, v2);

    const sim = cosineSimilarity(v1, v3);
    assert.ok(sim < 0.99, 'Different inputs should produce different vectors');
  } finally {
    delete process.env.VIDEO_CLI_MOCK_GEMINI;
  }
});

test('buildEmbeddings falls back to transcript segments when utterances are missing', async () => {
  process.env.VIDEO_CLI_MOCK_GEMINI = '1';
  try {
    const items = await buildEmbeddings({
      apiKey: null,
      manifest: null,
      ocr: null,
      transcript: {
        items: [
          {
            segments: [
              { startSec: 1, endSec: 2.5, text: 'segment-only transcript' },
            ],
          },
        ],
      },
      config: {
        model: 'mock-model',
        dimensions: 16,
        taskTypeDocument: 'RETRIEVAL_DOCUMENT',
        sources: {
          transcript: true,
          ocr: false,
          frames: false,
        },
      },
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'transcript');
    assert.equal(items[0].text, 'segment-only transcript');
    assert.equal(items[0].startSec, 1);
    assert.equal(items[0].endSec, 2.5);
  } finally {
    delete process.env.VIDEO_CLI_MOCK_GEMINI;
  }
});
