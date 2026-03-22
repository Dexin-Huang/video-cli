const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canSpawnNodeChildProcess,
  createSampleVideo,
  repoRoot,
  runCliJson,
} = require('./helpers/cli-test-helpers');

const contractRoot = path.join(repoRoot, 'contracts');
const tmpRoot = path.join(repoRoot, '.tmp_contract_test');
const dataRoot = path.join(tmpRoot, 'data', 'videos');
const canSpawnChildren = canSpawnNodeChildProcess();

const mockEnv = {
  VIDEO_CLI_DATA_ROOT: dataRoot,
  VIDEO_CLI_MOCK_GEMINI: '1',
  VIDEO_CLI_MOCK_DEEPGRAM: '1',
  VIDEO_CLI_MOCK_ELEVENLABS: '1',
};

test.before(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('key CLI outputs stay schema-valid and stable', { skip: !canSpawnChildren }, () => {
  const sampleVideo = path.join(tmpRoot, 'sample.mp4');
  createSampleVideo(sampleVideo);

  const outputs = {};
  outputs.config = runCli(['config']);
  outputs.setup = runCli(['setup', sampleVideo]);
  outputs.status = runCli(['status', outputs.setup.id]);
  outputs.search = runCli(['search', outputs.setup.id, 'mock', '--top', '3']);
  outputs.ask = runCli(['ask', outputs.setup.id, 'what is in this video']);

  for (const [name, value] of Object.entries(outputs)) {
    assertMatchesSchema(value, loadSchema(name), `$${name}`);
  }

  const sanitized = sanitizeOutputs(outputs, {
    videoId: outputs.setup.id,
    sampleVideo,
  });

  for (const [name, value] of Object.entries(sanitized)) {
    assert.deepEqual(value, loadGolden(name), `${name} output drifted`);
  }
});

function runCli(args) {
  return runCliJson(args, { env: mockEnv });
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(contractRoot, 'schema', `${name}.schema.json`), 'utf8'));
}

function loadGolden(name) {
  return JSON.parse(fs.readFileSync(path.join(contractRoot, 'goldens', `${name}.json`), 'utf8'));
}

function sanitizeOutputs(outputs, { videoId, sampleVideo }) {
  const replacements = [
    [normalizeForCompare(sampleVideo), '<sample-video>'],
    [normalizeForCompare(dataRoot), '<data-root>'],
    [normalizeForCompare(repoRoot), '<repo-root>'],
    [videoId, '<video-id>'],
  ];

  return sanitizeValue(outputs, replacements);
}

function sanitizeValue(value, replacements) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, replacements)]));
  }

  if (typeof value === 'string') {
    let output = normalizeForCompare(value);
    for (const [needle, replacement] of replacements) {
      output = output.split(needle).join(replacement);
    }
    return output;
  }

  return value;
}

function normalizeForCompare(value) {
  return String(value).replace(/\\/g, '/');
}

function assertMatchesSchema(value, schema, pointer) {
  if (!schema || typeof schema !== 'object') {
    throw new Error(`Invalid schema at ${pointer}`);
  }

  if ('const' in schema) {
    assert.deepEqual(value, schema.const, `${pointer} should equal const value`);
  }

  if (schema.enum) {
    assert.ok(schema.enum.some(item => deepEqual(item, value)), `${pointer} should be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert.ok(expectedTypes.some(type => matchesType(value, type)), `${pointer} should match type ${expectedTypes.join(' | ')}`);
  }

  if (typeof value === 'string') {
    if ('minLength' in schema) {
      assert.ok(value.length >= schema.minLength, `${pointer} should have minLength ${schema.minLength}`);
    }
    if (schema.pattern) {
      assert.match(value, new RegExp(schema.pattern), `${pointer} should match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if ('minimum' in schema) {
      assert.ok(value >= schema.minimum, `${pointer} should be >= ${schema.minimum}`);
    }
  }

  if (Array.isArray(value)) {
    if ('minItems' in schema) {
      assert.ok(value.length >= schema.minItems, `${pointer} should have at least ${schema.minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => assertMatchesSchema(item, schema.items, `${pointer}[${index}]`));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = schema.required || [];
    for (const key of required) {
      assert.ok(Object.prototype.hasOwnProperty.call(value, key), `${pointer}.${key} is required`);
    }

    const properties = schema.properties || {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      assertMatchesSchema(value[key], propSchema, `${pointer}.${key}`);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.ok(Object.prototype.hasOwnProperty.call(properties, key), `${pointer}.${key} is not allowed by schema`);
      }
    }
  }
}

function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function deepEqual(left, right) {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}
