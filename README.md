<p align="center">
  <img src="assets/logo.png" alt="video-cli" width="120">
</p>

<h1 align="center">video-cli</h1>

<p align="center">
  <strong>Make a video behave like a codebase: searchable, inspectable, citeable.</strong>
</p>

<p align="center">
  Video is opaque to most tools. `video-cli` turns it into local artifacts an agent can query with evidence.
</p>

<p align="center">
  <a href="https://github.com/Dexin-Huang/video-cli/actions/workflows/test.yml"><img src="https://github.com/Dexin-Huang/video-cli/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node >= 22"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0-orange.svg" alt="Zero Dependencies"></a>
</p>

## Why It Exists

Video is hard to work with programmatically. You can watch it, but you cannot `grep` it, cite it, diff it, or hand it to an agent and expect repeatable answers.

`video-cli` exists to make a video usable as a working surface: it extracts transcript spans, OCR text, frame descriptions, embeddings, timestamps, frames, and clips so an agent can search and answer with grounded evidence.

## Quick Start

```bash
video-cli init
video-cli setup video.mp4
video-cli ask <id> "what is the main argument?"
```

That is the normal path: initialize credentials once, ingest a video once, then ask questions against the local artifacts.

## Install

Published package:

```bash
npm install -g video-cli
video-cli init
```

Repo checkout:

```bash
git clone https://github.com/Dexin-Huang/video-cli
cd video-cli
cp .env.example .env
node video-cli.js init
```

The published package is the normal user path. The repo-local `node video-cli.js ...` form is mainly for development and contributor workflows.

## Onboarding

1. Add your API key with `video-cli init`.
2. Run `video-cli setup <video-file>` to build the artifacts.
3. Ask a grounded question with `video-cli ask <video-id> "<question>"`.
4. Use `video-cli search`, `context`, `chapters`, `frame`, or `clip` when you need to inspect a specific moment.

## Example

```bash
video-cli setup lecture.mp4
# { "id": "lec-abc123", "ready": true, ... }

video-cli ask lec-abc123 "what is the main argument?"
# { "answer": "...", "citations": [...], "suggestedFollowUps": [...] }

video-cli context lec-abc123 --at 198 --window 15
# { "utterances": [...], "ocrItems": [...], "frames": [...], "sceneChanges": [...] }

video-cli clip lec-abc123 --at 198 --pre 5 --post 10
# { "output": "data/videos/lec-abc123/clips/clip-198_000.mp4" }
```

## Command Surface

| Area | Commands | Purpose |
|------|----------|---------|
| **Intent** | `setup`, `ask` | Ingest a video or answer a question with evidence |
| **Navigate** | `search`, `context`, `chapters`, `next`, `grep` | Find and inspect specific moments |
| **Extract** | `frame`, `clip` | Pull out a still image or short clip |
| **Pipeline** | `ingest`, `transcribe`, `ocr`, `analyze`, `embed`, `describe` | Run individual stages when you need control |
| **Inspect** | `list`, `status`, `inspect`, `timeline`, `watchpoints`, `bundle`, `brief`, `config` | Check readiness and inspect artifacts |
| **Automation** | `eval:generate`, `eval:run` | Measure retrieval quality |

## How It Works

```text
video.mp4
  -> ffmpeg scene detection
  -> transcription
  -> OCR + frame descriptions
  -> embeddings
  -> searchable JSON artifacts on disk

query
  -> semantic + lexical + description search
  -> grounded answer with citations and follow-ups
```

## Configuration

`video-cli` reads `video-cli.config.json` in the repo root and merges it with `video-cli.config.example.json`, plus environment overrides. The main knobs are provider selection, transcription chunking, OCR model choice, and embedding dimensions.

Use `video-cli config` to see the resolved runtime config. Use `GEMINI_API_KEY` for the default path, and override providers with `--provider` or env vars when needed.

## Requirements

- Node 22 or newer
- `ffmpeg` and `ffprobe`
- `GEMINI_API_KEY` in `.env`

## For AI Agents

See [SKILL.md](SKILL.md) for the agent-facing command reference and output shapes.

## Development

```bash
npm test              # 20 tests, no API calls
npm run eval          # retrieval quality eval
```

Zero npm dependencies. Pure Node.js + ffmpeg.

## License

[MIT](LICENSE)
