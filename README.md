# video-cli

Local-first CLI that makes videos searchable and inspectable for AI agents.

Ingest a video, then ask questions with grounded citations -- or search, navigate chapters, extract frames and clips. All commands return JSON.

## Quick Start

```bash
# one-time setup: ingest + transcribe + OCR + embed
video-cli setup recording.mp4

# ask a question
video-cli ask <id> "what is the main argument?"
```

Most agent sessions are 1-3 commands. `setup` then `ask` handles the 80% case.

## Command Tiers

### Tier 1: Intent Commands

| Command | Purpose |
|---------|---------|
| `setup <file>` | Ingest + transcribe + OCR + embed in one step |
| `ask <id> <question>` | Answer with grounded citations |

### Tier 2: Navigation and Extraction

| Command | Purpose |
|---------|---------|
| `search <id> <query>` | Semantic + lexical search |
| `context <id> --at <sec>` | Everything around a timestamp |
| `chapters <id>` | Segment into chapters |
| `next <id> --from <sec>` | Next significant moment |
| `grep <id> <text>` | Exact substring search (no embeddings) |
| `frame <id> --at <sec>` | Extract a single frame as JPG |
| `clip <id> --at <sec>` | Extract a short video clip |

### Tier 3: Pipeline and Inspection

| Command | Purpose |
|---------|---------|
| `ingest <file>` | Probe video, detect scenes, pick watchpoints |
| `transcribe <id>` | Transcribe audio (Deepgram nova-3) |
| `ocr <id>` | OCR representative frames (Gemini flash-lite) |
| `embed <id>` | Build embeddings from transcript + OCR + frames |
| `describe <id>` | Dense frame descriptions (optional) |
| `list` | List all ingested videos |
| `inspect <id>` | Full manifest JSON |
| `timeline <id>` | Watchpoints + scene change timestamps |
| `watchpoints <id>` | Raw watchpoint data |
| `bundle <id>` | Evidence bundle with frame paths |
| `brief <id>` | Render evidence as Markdown |
| `config` | Show runtime configuration |

## Requirements

- Node >= 22
- `ffmpeg` and `ffprobe`
- API keys: `GEMINI_API_KEY`, `DEEPGRAM_API_KEY` in `.env`

## Installation

```bash
cp .env.example .env
# fill in API keys
node video-cli.js setup ./sample.mp4
```

## Agent Integration

See [SKILL.md](SKILL.md) for the complete agent-facing reference: all commands, output shapes, flags, and session examples.

## Tests and Evals

```bash
npm test              # black-box CLI tests
npm run eval          # deterministic retrieval evals
npm run eval:json     # JSON output for agent loops
npm run goldens:check # golden-set scaffold
```

The eval harness uses synthetic local fixtures. It does not call Gemini or Deepgram.

## Repo Layout

- `src/cli.js` -- command routing
- `src/lib/` -- storage, media, providers, search, embeddings, ask
- `tests/` -- black-box CLI tests
- `evals/` -- deterministic regression evals for retrieval
- `goldens/` -- planned mixed 15-video golden set
- `docs/` -- architecture notes
- `SKILL.md` -- agent-facing command reference
