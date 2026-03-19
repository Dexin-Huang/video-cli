# video-cli Interface Design

## Philosophy

The video is an opaque blob. The CLI turns it into a navigable world. The interface has three tiers, modeled after playwright-cli:

1. **Intent commands** — what the agent usually calls. One shot, returns a complete answer.
2. **Navigation primitives** — targeted operations for drilling deeper. Each one returns structured JSON.
3. **Raw access** — escape hatches for power users and edge cases.

Most agent sessions should be 1-3 commands. The primitives exist for when the intent commands aren't enough.

## Command Tiers

### Tier 1: Intent Commands (the 80% case)

```
video-cli ingest <file> [--adaptive]
  → Ingest a video. Adaptive watchpoints at visual transition outliers.
  → Returns: id, duration, watchpoint count, chapter summary

video-cli ask <id> <question>
  → Answer a question about the video with grounded citations.
  → Internally: search → gather context → synthesize via Flash-Lite
  → Returns: { answer, citations[], suggestedFollowUps[] }

video-cli summarize <id> [--depth brief|full]
  → Produce a structured summary of the entire video.
  → Returns: { chapters[], keyTopics[], duration }
```

### Tier 2: Navigation Primitives (drill deeper)

```
video-cli search <id> <query> [--top N]
  → Semantic + lexical + description search. Returns ranked matches.

video-cli context <id> --at <seconds> [--window N]
  → Everything around a timestamp: transcript, OCR, frame descriptions, scene changes.
  → JIT enrichment: describes frames on demand if not cached.

video-cli chapters <id>
  → Segment video into chapters from scene changes + topic shifts.

video-cli next <id> --from <seconds>
  → Next significant moment (scene change, utterance, OCR change).

video-cli frame <id> --at <seconds>
  → Extract a single frame as JPG.

video-cli clip <id> --at <seconds> [--pre N] [--post N]
  → Extract a short video clip.

video-cli grep <id> <exact-text>
  → Exact substring search over transcript + OCR. No embeddings needed.
```

### Tier 3: Raw Access (escape hatches)

```
video-cli inspect <id>
  → Full manifest JSON.

video-cli timeline <id>
  → All watchpoints + scene change timestamps.

video-cli watchpoints <id> [--materialize]
  → Raw watchpoint data with optional frame extraction.

video-cli bundle <id>
  → Evidence bundle: watchpoints + coverage windows + frame paths.
```

### Ingest Pipeline (run once per video)

```
video-cli ingest <file>         → manifest (free, local)
video-cli transcribe <id>       → transcript.json (Deepgram, ~$0.004/min)
video-cli ocr <id>              → ocr.json (Gemini Flash-Lite, ~$0.003)
video-cli embed <id>            → embeddings.json (Gemini Embedding-2, ~$0.001)
video-cli describe <id>         → descriptions.json (optional dense, ~$0.01-0.03)
```

Or as one pipeline:
```
video-cli setup <file>          → runs ingest + transcribe + ocr + embed in sequence
```

## Output Design

Every command returns JSON. The agent parses it and decides the next move.

### `ask` output shape

```json
{
  "id": "ktrlfzlxcde-2c8fe1263c",
  "query": "tell me about Sal Stewart",
  "answer": "Sal Stewart is predicted to break out in 2026. The video describes him as 'going to absolutely mash this year,' having climbed the prospect ranks and exploded in 2025 with an OPS over 900 in the upper minors. He had an 18-game MLB callup with the Cincinnati Reds.",
  "citations": [
    {
      "atSec": 176.3,
      "source": "transcript",
      "text": "Sal Stewart is going to absolutely mash this year, slowly climbing the prospect ranks..."
    },
    {
      "atSec": 184.5,
      "source": "transcript",
      "text": "He exploded in 2025 with an OPS over 900 in the upper minors..."
    },
    {
      "atSec": 177,
      "source": "frame",
      "text": "Cincinnati Reds player wearing red jersey at bat at Great American Ball Park"
    }
  ],
  "suggestedFollowUps": [
    "What are his specific stats?",
    "Who else is predicted to break out?",
    "What did the manager say about him?"
  ]
}
```

### `context` output shape (snapshot-like)

```json
{
  "id": "...",
  "atSec": 176,
  "windowSec": 15,
  "startSec": 161,
  "endSec": 191,
  "utterances": [...],
  "ocrItems": [...],
  "frames": [...],
  "sceneChanges": [165.2, 177.0, 181.3, 185.0, 187.3, 189.0],
  "suggestedCommands": [
    "video-cli frame ktrlfzlxcde-2c8fe1263c --at 177",
    "video-cli clip ktrlfzlxcde-2c8fe1263c --at 176 --pre 5 --post 15",
    "video-cli next ktrlfzlxcde-2c8fe1263c --from 191"
  ]
}
```

## Agent Session Patterns

### Pattern 1: Quick answer (1-2 calls)
```
ingest lecture.mp4
ask <id> "what is the main argument?"
→ done
```

### Pattern 2: Exploration (3-5 calls)
```
ingest lecture.mp4
ask <id> "what topics are covered?"
→ sees mention of "cost function" in citations
ask <id> "explain the cost function section in detail"
→ wants to see the actual diagram
frame <id> --at 198
→ done
```

### Pattern 3: Deep dive (5+ calls)
```
ingest broadcast.mp4
chapters <id>
→ picks chapter 5 (interesting topic)
context <id> --at 154 --window 20
→ reads transcript + frame descriptions
search <id> "specific detail"
→ finds exact moment
clip <id> --at 238 --pre 5 --post 10
→ extracts evidence
```

### Pattern 4: Tutorial following
```
ingest tutorial.mp4
chapters <id>
→ gets step-by-step structure
context <id> --at <step1-time> --window 10
→ reads instructions for step 1
next <id> --from <step1-end>
→ finds step 2
context <id> --at <step2-time> --window 10
→ continues...
```

## Design Principles

1. **Token efficiency**: Output is structured JSON, not dumps. `ask` returns a paragraph, not a transcript.
2. **Progressive detail**: `ask` → `context` → `frame`/`clip`. Each step adds fidelity.
3. **JIT enrichment**: Frame descriptions generated on demand, cached for reuse. The video gets richer with use.
4. **Grounded citations**: Every claim in an `ask` answer links to a timestamp + source.
5. **Self-documenting**: `context` output includes `suggestedCommands`. The agent always knows what to try next.
6. **Cheap by default**: `ask` costs ~$0.0001 (one Flash-Lite call). The agent doesn't need to worry about cost.
