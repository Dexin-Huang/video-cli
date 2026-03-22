const { ensureDataRoot, getRepoRoot } = require('./lib/store');
const { getRuntimeConfig } = require('./lib/config');

const { runSetup, runAnalyze } = require('./commands/setup');
const { runAsk } = require('./commands/ask');
const { runSearch, runContext, runChapters, runNext, runGrep } = require('./commands/search');
const { runFrame, runClip } = require('./commands/media');
const { runIngest, runTranscribe, runOcr, runEmbed, runDescribe } = require('./commands/pipeline');
const { runList, runStatus, runInspect, runConfig, runBrief, runTimeline, runWatchpoints, runBundle } = require('./commands/inspect');
const { runEvalGenerate, runEvalRun } = require('./commands/eval');

const COMMAND_HELP = {
  setup: 'video-cli setup <file>\n\nRun the full pipeline: ingest + transcribe + analyze + embed.\nCreates all artifacts needed for search and ask.\n\nFlags:\n  --adaptive         Adaptive watchpoint selection (default: true)\n  --watchpoints N    Max watchpoints (default: auto)\n  --scene-threshold  Scene detection threshold (default: 0.35)',
  ask: 'video-cli ask <video-id> <question>\n\nAnswer a question with grounded citations.\nInternally: search → context → synthesize via Gemini Flash-Lite.\n\nReturns: answer, citations with timestamps, suggested follow-ups, frame paths.',
  search: 'video-cli search <video-id> <query> [--top N]\n\nSemantic + lexical + description search.\nReturns ranked matches with scores and timestamps.',
  context: 'video-cli context <video-id> --at <seconds> [--window N] [--no-enrich]\n\nEverything around a timestamp: transcript, OCR, frame descriptions, scene changes.\nJIT enrichment: describes frames on demand if not cached.',
  chapters: 'video-cli chapters <video-id>\n\nSemantic chapter segmentation based on transcript + visual cues.\nReturns chapter boundaries with titles and summaries.',
  next: 'video-cli next <video-id> --from <seconds>\n\nFind the next significant moment after a given timestamp.\nUses scene changes, transcript shifts, and visual novelty.',
  grep: 'video-cli grep <video-id> <text>\n\nExact substring search across transcript and OCR text.\nReturns matching segments with timestamps.',
  frame: 'video-cli frame <video-id> --at <seconds> [--out <path>]\n\nExtract a single frame as JPG at the given timestamp.\nDefaults to writing in the current directory.',
  clip: 'video-cli clip <video-id> --at <seconds> [--duration N] [--out <path>]\n\nExtract a video clip starting at the given timestamp.\nDefault duration: 10 seconds.',
  ingest: 'video-cli ingest <file>\n\nProbe video metadata and extract adaptive watchpoint frames.\nFirst step of the pipeline — run before transcribe/analyze.\n\nFlags:\n  --adaptive         Adaptive watchpoint selection (default: true)\n  --watchpoints N    Max watchpoints (default: auto)\n  --scene-threshold  Scene detection threshold (default: 0.35)',
  transcribe: 'video-cli transcribe <video-id>\n\nTranscribe audio track using ElevenLabs or Gemini.\nProduces word-level timestamps.',
  analyze: 'video-cli analyze <video-id>\n\nRun OCR + frame description in one pass via Gemini.\nProduces per-frame OCR text and visual descriptions.',
  embed: 'video-cli embed <video-id>\n\nBuild text embeddings for transcript and OCR segments.\nRequired for semantic search.',
  status: 'video-cli status <video-id>\n\nShow artifact readiness and pipeline completion status.\nLists which steps have been run and what is missing.',
  inspect: 'video-cli inspect <video-id> [--timeline] [--watchpoints]\n\nFull manifest dump for a video.\nOptionally include timeline events or watchpoint details.',
};

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

  if (flags.help && COMMAND_HELP[command]) {
    console.log(COMMAND_HELP[command]);
    return;
  }

  const helpers = { requirePositional, parseNumberFlag, parseBooleanFlag, printJson };

  if (command === 'init') return runInit();
  if (command === 'cleanup') return runCleanup(positionals, flags);
  if (command === 'ingest') return runIngest(positionals, flags, helpers);

  const commands = {
    setup: runSetup, ask: runAsk, list: runList, config: runConfig,
    inspect: runInspect, timeline: runTimeline, watchpoints: runWatchpoints,
    bundle: runBundle, brief: runBrief, ocr: runOcr, analyze: runAnalyze,
    transcribe: runTranscribe, grep: runGrep, frame: runFrame, clip: runClip,
    embed: runEmbed, search: runSearch, context: runContext, chapters: runChapters,
    next: runNext, describe: runDescribe, status: runStatus,
    'eval:generate': runEvalGenerate, 'eval:run': runEvalRun,
  };
  const handler = commands[command];
  if (!handler) throw new Error(`Unknown command: ${command}. Run 'video-cli --help' to see available commands.`);
  return handler(positionals, flags, config, helpers);
}

function printHelp() {
  const lines = [
    'video-cli \u2014 video REPL for AI agents',
    '',
    'Quick Start:',
    '  init                            Set up API key (interactive, secure)',
    '  cleanup [video-id] [--all]      Remove artifacts, data, or everything',
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

async function runCleanup(positionals, flags) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { getDataRoot } = require('./lib/store');

  const all = flags.all || flags.a;
  const videoId = positionals[0];

  if (videoId) {
    // Remove a single video's artifacts
    const videoDir = path.join(getDataRoot(), videoId);
    if (!fs.existsSync(videoDir)) {
      console.error(`No data found for video: ${videoId}`);
      process.exit(1);
    }
    fs.rmSync(videoDir, { recursive: true, force: true });
    console.error(`Removed: ${videoDir}`);
    return;
  }

  if (all) {
    // Remove everything: data, .env, config
    const dataRoot = getDataRoot();
    if (fs.existsSync(dataRoot)) {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      console.error(`Removed: ${dataRoot}`);
    }

    const envPath = path.join(getRepoRoot(), '.env');
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
      console.error(`Removed: ${envPath}`);
    }

    console.error('');
    console.error('All data and credentials removed.');
    console.error('Run "video-cli init" to set up again.');
    return;
  }

  console.error('Usage:');
  console.error('  video-cli cleanup <video-id>   Remove one video\'s artifacts');
  console.error('  video-cli cleanup --all        Remove all data + API key');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function runInit() {
  const fs = require('node:fs');
  const path = require('node:path');
  const readline = require('node:readline');

  const envPath = path.join(getRepoRoot(), '.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (existing.includes('GEMINI_API_KEY=') && !existing.includes('GEMINI_API_KEY=your-')) {
    console.error('API key already configured in .env');
    console.error('To reconfigure, delete the GEMINI_API_KEY line from .env and run init again.');
    return;
  }

  console.error('video-cli init — set up your Gemini API key');
  console.error('');
  console.error('Get your key at: https://aistudio.google.com/apikey');
  console.error('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  const key = await new Promise(resolve => {
    // Disable echo for secure input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      let input = '';
      process.stderr.write('Paste your GEMINI_API_KEY (hidden): ');
      process.stdin.on('data', chunk => {
        const ch = chunk.toString();
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stderr.write('\n');
          rl.close();
          resolve(input.trim());
        } else if (ch === '\x7f' || ch === '\b') {
          input = input.slice(0, -1);
        } else if (ch === '\x03') {
          process.exit(1);
        } else {
          input += ch;
        }
      });
    } else {
      // Non-TTY (piped input)
      rl.question('GEMINI_API_KEY: ', answer => { rl.close(); resolve(answer.trim()); });
    }
  });

  if (!key) {
    console.error('No key provided. Aborting.');
    process.exit(1);
  }

  // Validate the key with a simple API call
  console.error('Validating key...');
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (!response.ok) {
      console.error('Invalid API key. Check your key and try again.');
      process.exit(1);
    }
    console.error('Key is valid.');
  } catch {
    console.error('Could not reach Gemini API. Check your network and try again.');
    process.exit(1);
  }

  // Write to .env
  const lines = existing ? existing.split(/\r?\n/).filter(l => !l.startsWith('GEMINI_API_KEY=')) : [];
  lines.push(`GEMINI_API_KEY=${key}`);
  fs.writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n');

  console.error('');
  console.error('Done! API key saved to .env');
  console.error('');
  console.error('Next: video-cli setup <video-file>');
}

module.exports = {
  main,
};
