<p align="center">
  <img src="assets/logo.png" alt="video-cli" width="120">
</p>

<h1 align="center">video-cli</h1>

<p align="center">
  <strong>Make a video feel like a codebase — searchable, inspectable, citeable.</strong>
</p>

<p align="center">
  One API key. Two cents per hour of video. Every answer grounded in timestamps.
</p>

<p align="center">
  <a href="https://github.com/Dexin-Huang/video-cli/actions/workflows/test.yml"><img src="https://github.com/Dexin-Huang/video-cli/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node >= 22"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0-orange.svg" alt="Zero Dependencies"></a>
</p>

## Quick Start

```bash
node video-cli.js init                              # set up API key (secure, interactive)
node video-cli.js setup video.mp4                   # ingest + transcribe + analyze + embed
node video-cli.js ask <id> "what is the main argument?"
```

That's it. `setup` ingests, transcribes, OCRs, and embeds. `ask` returns a grounded answer with timestamps and citations. Most sessions are 1-3 commands.

## What It Does

```
You have a video.  →  setup  →  Now it's searchable.
                                 ask    "what happened at the end?"
                                 search "pricing discussion"
                                 context --at 3:45
                                 chapters
                                 frame --at 2:30
                                 clip --at 2:30 --pre 5 --post 10
```

Every command returns JSON. An AI agent can `setup` a meeting recording then `ask` questions about it — with cited timestamps, frame paths, and suggested follow-ups.

## Commands

| Tier | Commands | What they do |
|------|----------|-------------|
| **Intent** | `setup`, `ask` | One-shot: ingest a video or answer a question |
| **Navigate** | `search`, `context`, `chapters`, `next`, `grep` | Drill into specific moments |
| **Extract** | `frame`, `clip` | Pull out frames or video clips |
| **Pipeline** | `ingest`, `transcribe`, `analyze`, `embed` | Run pipeline steps individually |
| **Inspect** | `list`, `status`, `inspect`, `brief`, `config` | Check what's available |

## How It Works

```
video.mp4
  → ffmpeg scene detection (free, local)
  → Gemini transcription ($0.0002/min)
  → Gemini OCR + frame descriptions ($0.003)
  → Gemini embeddings ($0.0002)
  → searchable JSON artifacts on disk

query
  → semantic + lexical + description search (local, instant)
  → Gemini synthesizes answer ($0.0001)
  → { answer, citations[], suggestedFollowUps[], framePaths[] }
```

## Cost

| Video length | Setup cost | Per query |
|---|---|---|
| 5 min | $0.002 | $0.0001 |
| 1 hour | $0.018 | $0.0001 |
| 10 hours | $0.18 | $0.0001 |

One API key (`GEMINI_API_KEY`) powers everything. Optionally swap in ElevenLabs or Deepgram for transcription via `--provider`.

## Requirements

- Node >= 22
- `ffmpeg` and `ffprobe`
- `GEMINI_API_KEY` in `.env`

## For AI Agents

See **[SKILL.md](SKILL.md)** — the complete agent-facing reference with output shapes, flags, and session examples.

## Development

```bash
npm test              # 16 tests, no API calls
npm run eval          # retrieval quality eval
```

Zero npm dependencies. Pure Node.js + ffmpeg.

## License

[MIT](LICENSE)
