---
name: video-cli
description: Makes videos searchable and inspectable for AI agents. Use when the user needs to answer questions about a video, search for moments, extract frames or clips, read on-screen text, or navigate video content by topic.
allowed-tools: Bash(video-cli:*)
---

# Video Inspection with video-cli

video-cli makes videos searchable and inspectable for AI agents. It ingests a video file, transcribes audio, OCRs on-screen text, and builds embeddings -- all locally. Once set up, you can ask natural-language questions with grounded citations, search for specific moments, navigate by chapter, and extract frames or clips. All commands return JSON.

## Quick Start

```bash
# one-time setup: ingest + transcribe + analyze + embed
video-cli setup recording.mp4
# ask a question with grounded citations
video-cli ask <id> "what is the main argument?"
```

## Commands

### Quick Start

```bash
video-cli setup <file>
# Runs ingest + transcribe + analyze + embed in one step.
# Returns: { id, sourceName, durationSec, watchpoints, utterances, ocrItems, embeddings, ready }

video-cli ask <video-id> <question>
# Answer a question with grounded citations.
# Internally: search -> gather context -> synthesize via LLM
# Returns: { id, query, answer, citations[], suggestedFollowUps[] }
```

### Navigation

```bash
video-cli search <video-id> <query> [--top N] [--threshold N] [--hybrid]
# Semantic + lexical + description search. Returns ranked matches.

video-cli context <video-id> --at <seconds> [--window N]
# Everything around a timestamp: transcript, OCR, frame descriptions, scene changes.
# JIT enrichment: describes frames on demand if not cached.

video-cli chapters <video-id>
# Segment video into chapters from scene changes + topic shifts.

video-cli next <video-id> --from <seconds>
# Next significant moment (scene change, utterance, OCR change).

video-cli grep <video-id> <exact-text>
# Exact substring search over transcript + OCR. No embeddings needed.
```

### Extraction

```bash
video-cli frame <video-id> --at <seconds> [--output <path>]
# Extract a single frame as JPG.

video-cli clip <video-id> --at <seconds> [--pre N] [--post N] [--output <path>]
# Extract a short video clip around a timestamp.
```

### Pipeline

These run individually if you need fine-grained control. `setup` runs them all.

```bash
video-cli ingest <file> [--watchpoints N] [--scene-threshold N]
# Probe video, detect scene changes, pick watchpoints. Local only, no API calls.

video-cli transcribe <video-id> [--chunk-seconds N] [--limit N] [--provider <name>] [--model <name>] [--trim-silence]
# Transcribe audio. Default: Gemini (gemini-transcribe). Use --provider elevenlabs for word-level timestamps + audio events, or --provider deepgram.

video-cli ocr <video-id> [--limit N] [--provider <name>] [--model <name>]
# OCR representative frames. Default: Gemini flash-lite.

video-cli embed <video-id> [--dimensions N] [--no-frames] [--no-transcript] [--no-ocr]
# Build embeddings from transcript + OCR + frame descriptions.

video-cli describe <video-id> [--interval N] [--model <name>]
# Dense frame descriptions at N-second intervals. Optional, enriches search.
```

### Inspection

```bash
video-cli list
# List all ingested videos.

video-cli inspect <video-id>
# Full manifest JSON.

video-cli timeline <video-id>
# All watchpoints + scene change timestamps.

video-cli watchpoints <video-id> [--limit N] [--materialize]
# Raw watchpoint data with optional frame extraction.

video-cli bundle <video-id> [--limit N]
# Evidence bundle: watchpoints + coverage windows + frame paths.

video-cli brief <video-id> [--limit N] [--output <path>]
# Render evidence bundle as Markdown.

video-cli config
# Show current runtime configuration.
```

## Output Shapes

### `ask`

```json
{
  "id": "abc123-def456",
  "query": "tell me about Sal Stewart",
  "answer": "Sal Stewart is predicted to break out in 2026...",
  "citations": [
    { "atSec": 176.3, "source": "transcript", "text": "Sal Stewart is going to absolutely mash..." },
    { "atSec": 177, "source": "frame", "text": "Cincinnati Reds player wearing red jersey..." }
  ],
  "suggestedFollowUps": [
    "What are his specific stats?",
    "Who else is predicted to break out?"
  ]
}
```

### `search`

```json
{
  "id": "abc123-def456",
  "query": "cost function",
  "matchCount": 3,
  "matches": [
    {
      "score": 1.82,
      "source": "transcript",
      "atSec": 198.5,
      "startSec": 195.0,
      "endSec": 210.0,
      "text": "the cost function measures how far off..."
    }
  ]
}
```

### `context`

```json
{
  "id": "abc123-def456",
  "atSec": 176,
  "windowSec": 10,
  "startSec": 166,
  "endSec": 186,
  "utterances": ["..."],
  "ocrItems": ["..."],
  "frames": ["..."],
  "sceneChanges": [165.2, 177.0, 181.3],
  "suggestedCommands": [
    "video-cli frame abc123-def456 --at 177",
    "video-cli clip abc123-def456 --at 176 --pre 5 --post 15",
    "video-cli next abc123-def456 --from 186"
  ]
}
```

### `chapters`

```json
{
  "id": "abc123-def456",
  "durationSec": 600,
  "chapterCount": 5,
  "chapters": [
    {
      "index": 0,
      "startSec": 0,
      "endSec": 120.5,
      "durationSec": 120.5,
      "utteranceCount": 14,
      "text": "Welcome to the presentation...",
      "summary": "Title slide with speaker introduction"
    }
  ]
}
```

## Session Examples

### Quick answer (1-2 calls)

```bash
video-cli setup lecture.mp4
# { "id": "lec-abc123", "ready": true, "durationSec": 3600, ... }

video-cli ask lec-abc123 "what is the main argument?"
# { "answer": "The main argument is...", "citations": [...] }
```

### Exploration (3-5 calls)

```bash
video-cli setup lecture.mp4
# { "id": "lec-abc123", ... }

video-cli ask lec-abc123 "what topics are covered?"
# sees "cost function" in citations at 198s

video-cli context lec-abc123 --at 198 --window 15
# reads transcript + OCR + frame descriptions around that moment

video-cli frame lec-abc123 --at 198
# extracts the diagram frame as JPG
# { "output": "data/videos/lec-abc123/frames/frame-198_000.jpg" }
```

### Deep dive with chapters (5+ calls)

```bash
video-cli setup broadcast.mp4
# { "id": "bcast-def456", "durationSec": 1200, ... }

video-cli chapters bcast-def456
# { "chapterCount": 8, "chapters": [{ "index": 0, "startSec": 0, ... }, ...] }

video-cli context bcast-def456 --at 154 --window 20
# reads everything around chapter 5

video-cli search bcast-def456 "playoff implications"
# finds exact moment at 238s

video-cli clip bcast-def456 --at 238 --pre 5 --post 10
# extracts 15-second evidence clip
# { "output": "data/videos/bcast-def456/clips/clip-238_000.mp4" }
```

## Notes

- All commands return JSON to stdout. Progress messages go to stderr.
- `setup` is the recommended entry point. It runs `ingest`, `transcribe`, `analyze`, and `embed` in sequence.
- `ask` performs JIT enrichment: if frame descriptions are missing for the relevant region, it generates them on demand and caches them.
- `context` output includes `suggestedCommands` -- the agent always knows what to try next.
- Video IDs are deterministic hashes of file identity (path + size + mtime). Re-ingesting the same file returns the same ID.
- Requires `ffmpeg`, `ffprobe`, Node >= 22, and `GEMINI_API_KEY` in the environment. One API key powers everything. ElevenLabs and Deepgram are available as optional overrides via `--provider elevenlabs` / `--provider deepgram`.
