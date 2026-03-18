# Video CLI Ideas

## Goal

Build an agent-friendly CLI for long videos that is:

- Fast on local machines
- Lightweight in dependencies and storage
- Good at exact retrieval, not just vague semantic search
- Able to surface relevant frames, transcript spans, and short clips on demand

The main design constraint is fidelity. An hour-long video should not be collapsed into one embedding or one summary. The CLI should keep exact timestamped evidence and only use embeddings as a secondary retrieval layer.

## Working Definition Of "Grep Video"

For this project, "grep video" should mean:

- Search transcript text with timestamps
- Search OCR text found in frames
- Search generated captions or tags for visual events
- Expand any hit into neighboring context
- Pull frames or a short clip around the hit

That makes the video inspectable by an agent in the same way a codebase is inspectable by `rg`: exact hits first, semantic recovery second, heavy artifacts only when needed.

## Design Principles

1. Keep the source of truth exact.
   Transcript spans, OCR text, shot boundaries, and frame timestamps are the durable artifacts.

2. Prefer hierarchical retrieval over large-context inference.
   Retrieve small precise spans first, then widen context if needed.

3. Make the fast path cheap.
   A useful first ingest should work without embeddings, frame captioning, or remote APIs.

4. Defer expensive work.
   Extract clips, dense frames, and multimodal summaries only when a query actually needs them.

5. Output compact JSON.
   Agents should consume IDs, timestamps, and paths, then request deeper inspection explicitly.

## Recommended MVP

The fastest useful version is:

- Audio transcription
- Transcript chunking with timestamps
- SQLite storage
- FTS5 exact search
- On-demand frame extraction with `ffmpeg`
- Optional shot detection

This already supports:

- `video ingest file.mp4`
- `video grep "exact phrase"`
- `video inspect hit_123`
- `video frames hit_123 --every 2s --window 20s`
- `video clip hit_123 --pre 8 --post 12`

This is likely enough to make the CLI genuinely useful before adding Gemini or any vector index.

## Proposed Retrieval Stack

### Layer 1: Exact Search

Store transcript chunks and OCR text in SQLite FTS5.

Why this matters:

- Exact lookup is fast
- Easy to debug
- High precision on named entities, code, UI labels, and spoken phrases
- Works well on hour-long videos if chunks are small

Recommended chunking:

- Transcript chunks: 10 to 20 seconds
- Overlap: 2 to 5 seconds
- Parent windows: 2 to 5 minutes for broader context

### Layer 2: Structural Video Index

Track:

- Video metadata from `ffprobe`
- Shot boundaries
- Keyframes per shot
- OCR text per keyframe
- Frame image paths

This lets the agent jump from a text hit to actual pixels without scanning the whole file again.

### Layer 3: Semantic Search

Use embeddings on transcript chunks, not the whole video.

Good uses:

- Recall when wording differs from the query
- Linking transcript language to visual descriptions
- Retrieving conceptually related segments

Bad use:

- Single embedding for a one-hour video

If embeddings are added, start with:

- Transcript chunk embeddings
- Optional frame caption embeddings
- Optional multimodal reranking for top results only

## Gemini Fit

Gemini is more compelling as a selective multimodal stage than as the primary index.

Good roles for Gemini:

- Embed transcript chunks or short segment summaries
- Rerank top candidate segments
- Caption selected keyframes
- Answer questions over a short shortlist of clips or frames

Less attractive for the first version:

- End-to-end indexing of every frame through a remote API
- Treating multimodal embeddings as the only retrieval layer

If the goal is fast and lightweight, the first version should not require Gemini to function.

## Suggested Commands

Core:

- `video ingest <file>`
- `video grep <query>`
- `video inspect <hit-id>`
- `video frames <hit-id>`
- `video clip <hit-id>`

Second wave:

- `video search <query>` for semantic retrieval
- `video ocr <video-or-hit>`
- `video summarize <segment-id>`
- `video export <hit-id> --format markdown|json`

Useful command behavior:

- Every command returns machine-readable JSON by default
- `--md` can produce human-friendly markdown
- IDs should be stable: `video_id`, `segment_id`, `shot_id`, `frame_id`, `hit_id`

## Storage Model

SQLite is the right default.

Tables:

- `videos`
- `transcript_segments`
- `shots`
- `frames`
- `ocr_spans`
- `artifacts`
- `embeddings` or an external vector store later

Reasons:

- Portable
- Easy to inspect
- Fast enough for local search
- FTS5 gives a strong exact-search baseline

Artifacts on disk:

- `data/videos/<video_id>/manifest.json`
- `data/videos/<video_id>/frames/...`
- `data/videos/<video_id>/clips/...`
- `data/videos/<video_id>/transcript.json`

## Performance Strategy

### Fast Ingest

Default ingest should avoid expensive multimodal work.

Pipeline:

1. Run `ffprobe`
2. Extract or transcribe audio
3. Chunk transcript
4. Index transcript into FTS
5. Optionally detect shots

This gets a searchable hour-long video quickly.

### Lazy Enrichment

Do these only when needed:

- OCR on frames near a search hit
- Dense keyframe extraction
- Frame captioning
- Embeddings
- Short clip rendering

This keeps initial latency and storage down.

### Frame Extraction

Use `ffmpeg` directly.

Why:

- Fast
- Already standard
- Easy to request one frame or a frame series by timestamp

This means `video frames hit_42` should not need precomputed frame dumps for the whole video.

## High-Fidelity Retrieval Pattern

A reliable agent loop looks like this:

1. `video grep "whiteboard roadmap"`
2. Read the returned timestamps and segment IDs
3. `video inspect segment_17`
4. `video frames segment_17 --window 30s --every 3s`
5. If needed, `video clip segment_17 --pre 10 --post 15`

This keeps the query path narrow and evidence-driven.

## Tech Choices

### Local-First Option

- Node.js or TypeScript CLI
- `ffmpeg` and `ffprobe`
- SQLite with FTS5
- `faster-whisper` or `whisper.cpp` via subprocess

Pros:

- Fast
- Cheap
- Works offline
- Easier to debug

Cons:

- More local setup
- OCR and caption quality depend on chosen tools

### Cloud-Assisted Option

- Same local CLI
- Gemini for embeddings, reranking, captioning, or QA

Pros:

- Better semantic retrieval and multimodal understanding
- Cleaner high-level answers on ambiguous queries

Cons:

- API cost
- More latency
- Harder to guarantee reproducibility

## Recommended Build Order

### V0

- `ingest`
- `grep`
- `inspect`
- `frames`
- `clip`

Backed by transcript + SQLite FTS + `ffmpeg`.

### V1

- Shot detection
- OCR on keyframes
- Better metadata and manifests

### V2

- Semantic `search`
- Embeddings on transcript chunks
- Gemini reranking or captioning on top hits

### V3

- Frame or segment multimodal embeddings
- Cross-video retrieval
- Agent-oriented workflows like "find all moments where the speaker references pricing while a slide is visible"

## Recommendation

Do not start with a fully multimodal embedding pipeline.

Start with the smallest thing that gives agents precise leverage:

- transcript search
- timestamped inspection
- on-demand frames
- on-demand clips

If that baseline feels strong, add embeddings as a retrieval boost rather than the foundation.
