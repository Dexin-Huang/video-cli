# video-cli

Local-first video inspection CLI for agents.

The current shape is:

- ingest a video once
- store local evidence under `data/videos/<id>/`
- OCR representative frames
- transcribe audio with timestamps
- grep that evidence without re-calling a model

## Status

This repo is still early, but the basic loop works:

- `ingest`
- `ocr`
- `transcribe`
- `grep`
- `frame`
- `clip`

The default preset is:

- OCR: Gemini `gemini-3.1-flash-lite-preview`
- transcription: Deepgram `nova-3`

## Requirements

- Node `>=22`
- `ffmpeg`
- `ffprobe`

## Setup

1. Create a local env file:

```powershell
Copy-Item .env.example .env
```

2. Fill in API keys in `.env`.

3. Run the CLI directly:

```powershell
node video-cli.js --help
```

## Example

```powershell
node video-cli.js ingest .\sample.mp4
node video-cli.js ocr <video-id>
node video-cli.js transcribe <video-id> --trim-silence
node video-cli.js grep <video-id> "tiebreaker"
node video-cli.js clip <video-id> --at 42.6 --pre 3 --post 3
```

## Tests And Evals

Black-box tests:

```powershell
npm test
```

Deterministic retrieval evals:

```powershell
npm run eval
```

JSON output for agent loops:

```powershell
npm run eval:json
```

The eval harness uses synthetic local fixtures. It does not call Gemini or Deepgram.

Golden-set scaffold:

```powershell
npm run goldens:check
```

## Repo Layout

- `src/cli.js`: command routing
- `src/lib/`: storage, media, providers, search helpers
- `tests/`: black-box CLI tests
- `evals/`: deterministic regression evals for retrieval behavior
- `goldens/`: planned mixed 15-video product-aligned golden set
- `docs/`: architecture notes
- `reference/`: external reference repo clone
