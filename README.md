<p align="center">
  <img src="assets/logo.png" alt="video-cli" width="120">
</p>

<h1 align="center">video-cli</h1>

<p align="center">
  <strong>Make a video behave like a codebase: searchable, inspectable, citable.</strong>
</p>

<p align="center">
  Video is opaque to most tools. <code>video-cli</code> turns it into local artifacts an agent can query with evidence.
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

`video-cli` starts from a built-in preset, then resolves runtime config in this order:

1. Built-in preset defaults
2. `video-cli.config.json` in the repo root
3. Environment variable overrides
4. Command flags for commands that expose them

Use `video-cli config` to inspect the final merged config that the CLI will actually use.

A typical `video-cli.config.json` looks like this:

```json
{
  "preset": "balanced",
  "ocr": {
    "provider": "gemini",
    "model": "gemini-3.1-flash-lite-preview",
    "watchpointLimit": 8
  },
  "transcribe": {
    "provider": "gemini-transcribe",
    "model": "gemini-3.1-flash-lite-preview",
    "chunkSeconds": 480,
    "trimSilence": false,
    "minSilenceSec": 1.5,
    "padSec": 0.25,
    "silenceNoiseDb": -35,
    "diarize": true,
    "utterances": true,
    "smartFormat": true,
    "punctuate": true,
    "detectLanguage": false,
    "language": null
  },
  "embed": {
    "provider": "gemini",
    "model": "gemini-embedding-2-preview",
    "dimensions": 768,
    "sources": {
      "transcript": true,
      "ocr": true,
      "frames": false
    }
  }
}
```

Common environment overrides:

- `VIDEO_CLI_PRESET`: choose the base preset before file/env overrides are merged
- `VIDEO_CLI_OCR_PROVIDER`, `VIDEO_CLI_OCR_MODEL`: change OCR provider/model
- `VIDEO_CLI_TRANSCRIBE_PROVIDER`, `VIDEO_CLI_TRANSCRIBE_MODEL`: change transcription provider/model
- `VIDEO_CLI_TRANSCRIBE_CHUNK_SECONDS`: change transcription chunk size
- `VIDEO_CLI_TRANSCRIBE_TRIM_SILENCE`, `VIDEO_CLI_TRANSCRIBE_MIN_SILENCE_SEC`, `VIDEO_CLI_TRANSCRIBE_PAD_SEC`: control silence trimming
- `VIDEO_CLI_EMBED_PROVIDER`, `VIDEO_CLI_EMBED_MODEL`, `VIDEO_CLI_EMBED_DIMENSIONS`: change embedding provider/model/dimensions
- `VIDEO_CLI_EMBED_TRANSCRIPT`, `VIDEO_CLI_EMBED_OCR`, `VIDEO_CLI_EMBED_FRAMES`: turn embedding sources on or off
- `VIDEO_CLI_DATA_ROOT`: move the artifact store away from the default `data/videos`
- `VIDEO_CLI_ID`: provide a default `<video-id>` for commands that normally take one as the first positional argument

Provider-specific model aliases are also accepted where relevant, including `GEMINI_OCR_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, and `DEEPGRAM_TRANSCRIBE_MODEL`.

## Requirements

- Node 22 or newer
- `ffmpeg` and `ffprobe`
- `GEMINI_API_KEY` in `.env` for the default path

## Troubleshooting

- `ffmpeg not found` or `ffprobe not found`
  Install `ffmpeg` and make sure both binaries are on `PATH`. The CLI shells out to them directly for probing, frame extraction, clip extraction, and silence detection.
- `No embeddings found` or `No transcript/ocr found`
  Run `video-cli setup <file>` for the normal path, or run the missing pipeline stage directly and re-check with `video-cli status <video-id>`.
- `Unknown video id`
  Run `video-cli list` to see available artifacts, or set `VIDEO_CLI_ID` if you want a default active video.
- PowerShell blocks `npm`
  On some Windows setups, PowerShell execution policy blocks `npm.ps1`. Use `npm.cmd ...` instead.
- Restricted sandboxes fail on child processes
  The CLI depends on subprocesses for `ffmpeg` and `ffprobe`. Some sandboxes block nested process execution; that is an environment limit, not a `video-cli` bug.

## For AI Agents

See [SKILL.md](SKILL.md) for the agent-facing command reference and output shapes.

## Development

```bash
npm test       # test suite
npm run eval   # retrieval quality eval
```

Zero npm dependencies. Pure Node.js plus `ffmpeg`.

## License

[MIT](LICENSE)
