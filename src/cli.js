const { ensureDataRoot, getRepoRoot } = require('./lib/store');
const { getRuntimeConfig } = require('./lib/config');

const { runSetup, runAnalyze } = require('./commands/setup');
const { runAsk } = require('./commands/ask');
const { runSearch, runContext, runChapters, runNext, runGrep } = require('./commands/search');
const { runFrame, runClip } = require('./commands/media');
const { runIngest, runTranscribe, runOcr, runEmbed, runDescribe } = require('./commands/pipeline');
const { runList, runStatus, runInspect, runConfig, runBrief, runTimeline, runWatchpoints, runBundle } = require('./commands/inspect');
const { runEvalGenerate, runEvalRun } = require('./commands/eval');

// Commands whose first positional is a video-id and can default to VIDEO_CLI_ID
const VIDEO_ID_COMMANDS = new Set([
  'ask', 'inspect', 'timeline', 'watchpoints', 'bundle', 'brief',
  'ocr', 'transcribe', 'grep', 'frame', 'clip', 'embed', 'search',
  'context', 'chapters', 'next', 'describe', 'analyze', 'status',
  'eval:generate', 'eval:run',
]);

async function main(argv) {
  ensureDataRoot();
  const config = getRuntimeConfig(getRepoRoot());

  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const { positionals, flags } = parseArgs(rest);

  // Default video-id from VIDEO_CLI_ID env var
  if (process.env.VIDEO_CLI_ID && VIDEO_ID_COMMANDS.has(command) && positionals.length === 0) {
    positionals.unshift(process.env.VIDEO_CLI_ID);
  }

  const helpers = { requirePositional, parseNumberFlag, parseBooleanFlag, printJson };

  switch (command) {
    case 'ingest':
      return runIngest(positionals, flags, helpers);
    case 'setup':
      return runSetup(positionals, flags, config, helpers);
    case 'ask':
      return runAsk(positionals, flags, config, helpers);
    case 'list':
      return runList(positionals, flags, config, helpers);
    case 'config':
      return runConfig(positionals, flags, config, helpers);
    case 'inspect':
      return runInspect(positionals, flags, config, helpers);
    case 'timeline':
      return runTimeline(positionals, flags, config, helpers);
    case 'watchpoints':
      return runWatchpoints(positionals, flags, config, helpers);
    case 'bundle':
      return runBundle(positionals, flags, config, helpers);
    case 'brief':
      return runBrief(positionals, flags, config, helpers);
    case 'ocr':
      return runOcr(positionals, flags, config, helpers);
    case 'analyze':
      return runAnalyze(positionals, flags, config, helpers);
    case 'transcribe':
      return runTranscribe(positionals, flags, config, helpers);
    case 'grep':
      return runGrep(positionals, flags, config, helpers);
    case 'frame':
      return runFrame(positionals, flags, config, helpers);
    case 'clip':
      return runClip(positionals, flags, config, helpers);
    case 'embed':
      return runEmbed(positionals, flags, config, helpers);
    case 'search':
      return runSearch(positionals, flags, config, helpers);
    case 'context':
      return runContext(positionals, flags, config, helpers);
    case 'chapters':
      return runChapters(positionals, flags, config, helpers);
    case 'next':
      return runNext(positionals, flags, config, helpers);
    case 'describe':
      return runDescribe(positionals, flags, config, helpers);
    case 'status':
      return runStatus(positionals, flags, config, helpers);
    case 'eval:generate':
      return runEvalGenerate(positionals, flags, config, helpers);
    case 'eval:run':
      return runEvalRun(positionals, flags, config, helpers);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  const lines = [
    'video-cli \u2014 video REPL for AI agents',
    '',
    'Quick Start:',
    '  setup <file>                    Full pipeline: ingest + transcribe + analyze + embed',
    '  ask <video-id> <question>       Answer with grounded citations',
    '',
    'Navigation:',
    '  search <video-id> <query>       Semantic + lexical search',
    '  context <video-id> --at T       Everything around a timestamp',
    '  chapters <video-id>             Semantic chapter segmentation',
    '  next <video-id> --from T        Next significant moment',
    '  grep <video-id> <text>          Exact substring search',
    '',
    'Extraction:',
    '  frame <video-id> --at T         Extract a single frame (JPG)',
    '  clip <video-id> --at T          Extract a video clip',
    '',
    'Pipeline (run individually if needed):',
    '  ingest <file>                   Probe video + adaptive watchpoints',
    '  transcribe <video-id>           Audio \u2192 transcript',
    '  analyze <video-id>              OCR + describe in one pass (Gemini)',
    '  embed <video-id>                Build embeddings (Gemini)',
    '',
    'Inspection:',
    '  list                            All ingested videos',
    '  status <video-id>               Artifact readiness + pipeline status',
    '  inspect <video-id>              Full manifest (--timeline, --watchpoints)',
    '  brief <video-id>                Markdown summary',
    '  config                          Current config',
    '',
    "Use 'video-cli <command> --help' for details on a specific command.",
  ];
  console.log(lines.join('\n'));
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const eqIndex = withoutPrefix.indexOf('=');
    if (eqIndex >= 0) {
      flags[withoutPrefix.slice(0, eqIndex)] = withoutPrefix.slice(eqIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[withoutPrefix] = next;
      i += 1;
      continue;
    }

    flags[withoutPrefix] = true;
  }

  return { positionals, flags };
}

function requirePositional(positionals, index, name) {
  const value = positionals[index];
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function parseNumberFlag(flags, name, fallback) {
  if (!(name in flags)) {
    return fallback;
  }
  const value = Number(flags[name]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for --${name}: ${flags[name]}`);
  }
  return value;
}

function parseBooleanFlag(flags, name, fallback) {
  if (!(name in flags)) {
    return fallback;
  }

  const value = flags[name];
  if (value === true) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value for --${name}: ${flags[name]}`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

module.exports = {
  main,
};
