# Video CLI Architecture Catalog

This document is a broad exploration of possible architectures for an agent-friendly long-video CLI.

The goal is not to pick one immediately. The goal is to generate enough distinct options that we can evaluate tradeoffs deliberately instead of defaulting to the first reasonable hybrid.

## Evaluation Axes

Use these axes when narrowing the list:

- Exactness: how well the system supports grep-like retrieval with clear evidence
- Visual recall: how well it handles things not present in transcript text
- Temporal reasoning: how well it answers before/after, recurrence, and event-sequence questions
- Ingest cost: how expensive and slow indexing is
- Query latency: how fast hard queries resolve
- Local-first fit: how much works without a remote model
- Explainability: how easy it is to show why a result matched
- Engineering risk: how hard it is to build and debug

## Architecture Ideas

### 1. Transcript Spine

- Core mechanism: Make timestamped transcript chunks the primary searchable substrate and treat everything else as refinement.
- Ingest path: Extract audio, transcribe, chunk with overlap, store in SQLite FTS.
- Query path: Exact search first, then semantic fallback, then local frame or clip extraction around hits.
- Strengths: Very fast, cheap, and easy to debug.
- Weaknesses: Blind to visual-only content.

### 2. Synthetic Document Compiler

- Core mechanism: Convert video into a pseudo-document made of timestamped sections containing transcript, sparse frames, OCR, and short captions.
- Ingest path: Chunk video into windows, extract one or two frames per window, OCR them, then render a markdown or HTML dossier.
- Query path: Use normal text search over the compiled document, then map matches back to timestamps and artifacts.
- Strengths: Extremely agent-friendly and grep-friendly.
- Weaknesses: Collapses temporal nuance and can become bulky on long videos.

### 3. OCR Canvas Index

- Core mechanism: Treat visible text as a first-class channel separate from speech.
- Ingest path: Detect shot changes or periodic frames, run OCR, normalize and timestamp text spans.
- Query path: Search OCR text directly and expand into nearby frames or clips.
- Strengths: Strong for slides, terminals, browser UIs, and screen recordings.
- Weaknesses: Weak for motion, actions, or scenes without text.

### 4. Shot Atlas

- Core mechanism: Segment by shot boundaries and index one representative frame plus sparse metadata per shot.
- Ingest path: Shot detection, keyframe extraction, OCR, optional captioning, local shot table storage.
- Query path: Search shot metadata and inspect neighboring shots on demand.
- Strengths: Cheap visual structure and good navigation.
- Weaknesses: Misses brief events inside long shots.

### 5. Event Tape

- Core mechanism: Convert video into a compact timeline of machine events such as cuts, motion spikes, speaker changes, silence, and slide changes.
- Ingest path: Run lightweight detectors over video and audio, then store event sequences with scores.
- Query path: Match user intent to event patterns and inspect the returned windows.
- Strengths: Fast and compact, especially for behavioral or change-driven questions.
- Weaknesses: Semantic meaning remains thin without a second stage.

### 6. State Delta Chain

- Core mechanism: Index what changed between adjacent states rather than indexing states alone.
- Ingest path: Compare neighboring frames or shots for text deltas, region changes, layout changes, and motion bursts.
- Query path: Search for classes of change such as screen transitions, new objects, or changed values.
- Strengths: Good for queries like "when did the page update" or "when did the chart change."
- Weaknesses: Poor at retrieving stable scenes that matter for reasons other than change.

### 7. Audio Motif Bank

- Core mechanism: Build a separate index for non-speech audio cues and short audio motifs.
- Ingest path: Run diarization, silence detection, coarse event detection, and audio embeddings on short windows.
- Query path: Search for applause, laughter, alarms, music transitions, interruptions, or repeated sound patterns.
- Strengths: Covers important evidence missing from transcript text.
- Weaknesses: Less useful for silent or screen-centric videos.

### 8. Query-Time Microscope

- Core mechanism: Keep ingest minimal and spend heavy analysis only when a query justifies it.
- Ingest path: Store transcript, rough shots, sparse thumbnails, and basic metadata.
- Query path: Use cheap retrieval to shortlist windows, then run OCR, denser frame extraction, captioning, or model inspection only on those windows.
- Strengths: Lowest ingest cost and adapts to the question.
- Weaknesses: Hard queries can take longer and may require multiple refinement loops.

### 9. Frame Fingerprint Grid

- Core mechanism: Sample frames sparsely and store perceptual hashes plus visual embeddings for approximate visual lookup.
- Ingest path: Periodic frame sampling plus scene changes, then pHash and embedding computation.
- Query path: Search by example image, text-to-image embedding, or nearest visual recurrence.
- Strengths: Strong for repeated layouts, recurring screens, and visual similarity.
- Weaknesses: Weak on temporal actions and expensive if sampled too densely.

### 10. Object Track Ledger

- Core mechanism: Detect and track persistent entities such as faces, logos, windows, or dominant objects across time.
- Ingest path: Sparse detection and tracking, then stable IDs with lifespans and representative frames.
- Query path: Search by entity label, example image, or co-occurrence pattern, then inspect track intervals.
- Strengths: Good for recurring actors and object-centric questions.
- Weaknesses: Detector quality can dominate system quality.

### 11. Temporal Proposal Engine

- Core mechanism: Generate candidate event intervals and search over those intervals instead of raw timeline slices.
- Ingest path: Sliding-window heuristics create event proposals such as demo-start, screen-change, gesture, applause, and topic shift.
- Query path: Map user questions to proposal types, then run focused reasoning over matching intervals.
- Strengths: Strong for "when does X happen" queries.
- Weaknesses: Proposal vocabularies can be brittle and domain-dependent.

### 12. Storyboard Pyramid

- Core mechanism: Build a multiscale hierarchy of whole-video, chapter, scene, shot, and frame nodes.
- Ingest path: Segment the video at multiple scales, attach summaries and representative artifacts to each level.
- Query path: Start coarse, descend only into relevant branches, and stop when evidence is sufficient.
- Strengths: Good long-range reasoning and efficient navigation for long videos.
- Weaknesses: Summaries can hide important edge cases.

### 13. Visual State Graph

- Core mechanism: Model recurring visual situations as graph nodes and transitions as edges.
- Ingest path: Cluster visually similar frames or shots into states, then record state transitions over time.
- Query path: Search for a state, then traverse the graph to answer sequence questions.
- Strengths: Excellent for tutorials, screen recordings, and repeated environments.
- Weaknesses: Less effective on continuous motion or unique one-off shots.

### 14. Scene Graph Timeline

- Core mechanism: Convert selected windows into structured entity-action-relation records over time.
- Ingest path: Extract entities, visible text, relations, attributes, and coarse actions for chosen windows.
- Query path: Parse the user question into structural constraints and match them against the timeline.
- Strengths: Powerful for compositional queries that transcript cannot cover.
- Weaknesses: Expensive and brittle extraction pipeline.

### 15. Patch Token Forest

- Core mechanism: Quantize spatiotemporal patches into discrete visual tokens and index token sequences rather than full frames.
- Ingest path: Break clips into patches or tubelets, map them into a finite codebook, then store token runs and local neighborhoods.
- Query path: Search for recurring token motifs or compare token patterns from example clips.
- Strengths: Compact, unusual, and potentially fast for repeated visual motifs.
- Weaknesses: Hard to engineer, hard to explain, and very research-heavy.

### 16. Multimodal Debate Retrieval

- Core mechanism: Run several retrieval experts in parallel and reconcile their disagreements.
- Ingest path: Build transcript, OCR, audio, frame, and clip indices tuned for different failure modes.
- Query path: Each expert proposes windows with evidence; a coordinator reranks or adjudicates the shortlist.
- Strengths: Robust to blind spots in any single modality.
- Weaknesses: Complex orchestration and harder debugging.

### 17. Interval SQL Engine

- Core mechanism: Represent everything as intervals and support explicit interval algebra queries.
- Ingest path: Store transcript spans, OCR spans, object tracks, shots, topics, and audio events as timestamp intervals in a relational model.
- Query path: Compile questions into interval joins like overlap, contains, before, after, nearest, and recurrence.
- Strengths: Very explainable and strong on temporal logic.
- Weaknesses: Needs a planner to translate natural language into interval logic reliably.

### 18. Self-Questioning Planner

- Core mechanism: Let the agent decompose a hard query into subqueries across modalities before retrieval.
- Ingest path: Maintain a modest set of indices rather than one huge index.
- Query path: Planner breaks a query into pieces such as spoken text, on-screen text, object presence, and order-of-events, then merges results.
- Strengths: Handles mixed queries better than one-shot retrieval.
- Weaknesses: Planner mistakes can waste time or miss obvious hits.

### 19. Domain Router

- Core mechanism: Detect the video type and route it through a specialized indexing recipe.
- Ingest path: Classify the video as screen recording, slide deck, talking head, lecture, gameplay, security footage, or product demo.
- Query path: Use domain-specific search behavior and artifacts for each class.
- Strengths: Keeps the system lightweight while boosting quality where domain structure exists.
- Weaknesses: Misclassification can send the video down the wrong path.

### 20. Evidence Bundle Compiler

- Core mechanism: Instead of returning a single "best hit," compile a bundle of supporting evidence for each candidate answer.
- Ingest path: Store pointers to transcript, OCR, frames, clips, and metadata in one evidence schema.
- Query path: Retrieve candidate intervals, then compile a dossier with timestamps, quotes, frames, and confidence notes.
- Strengths: Very agent-friendly and excellent for auditing results.
- Weaknesses: Slightly more overhead even on easy queries.

### 21. Memory Replay Cache

- Core mechanism: Cache prior query decompositions, candidate windows, and resolved evidence bundles as reusable memory.
- Ingest path: Build normal indices, then append query results as additional structured memory over time.
- Query path: Reuse similar prior searches before running fresh expensive analysis.
- Strengths: Useful for iterative analyst workflows and repeated questioning over the same corpus.
- Weaknesses: Can accumulate stale or misleading cached beliefs.

### 22. Anomaly Beacon

- Core mechanism: Index moments that look statistically unusual rather than semantically labeled.
- Ingest path: Compute novelty scores over motion, audio, OCR density, color distribution, layout, or object presence.
- Query path: Use anomaly spikes as candidate windows when the user asks for "weird," "sudden," or "notable" moments.
- Strengths: Finds interesting moments without a full ontology.
- Weaknesses: Many anomalies are irrelevant noise.

### 23. Cross-Video Episode Map

- Core mechanism: Build a graph across videos so recurring scenes, topics, people, or UI states become reusable anchors.
- Ingest path: Align segments across the corpus using transcript, OCR, and visual similarity.
- Query path: Retrieve one match, then fan out to analogous moments in other videos.
- Strengths: Powerful for collections such as lectures, support calls, or product demos over time.
- Weaknesses: Overkill for a single-video-first product.

## Clustered Observations

These ideas naturally cluster into a few larger families:

- Exact-local architectures: Transcript Spine, Synthetic Document Compiler, OCR Canvas Index, Interval SQL Engine
- Cheap-visual architectures: Shot Atlas, State Delta Chain, Event Tape, Audio Motif Bank
- Coarse-to-fine architectures: Query-Time Microscope, Storyboard Pyramid, Temporal Proposal Engine
- Entity-and-graph architectures: Object Track Ledger, Visual State Graph, Scene Graph Timeline
- Hybrid-orchestration architectures: Multimodal Debate Retrieval, Self-Questioning Planner, Evidence Bundle Compiler, Memory Replay Cache
- Radical-research architectures: Patch Token Forest, Anomaly Beacon, Cross-Video Episode Map

## Early Shortlist

If the goal is fast, lightweight, and high-performing for a first serious build, the strongest shortlist is:

1. Transcript Spine
2. OCR Canvas Index
3. Shot Atlas
4. Query-Time Microscope
5. Interval SQL Engine
6. Evidence Bundle Compiler

That combination gives:

- exact local grep
- visual recovery beyond transcript
- decent temporal reasoning
- low enough ingest cost to be practical
- a clean path to add semantic or multimodal layers later

If the goal is a more ambitious hybrid, the strongest second shortlist is:

1. Storyboard Pyramid
2. State Delta Chain
3. Multimodal Debate Retrieval
4. Self-Questioning Planner
5. Memory Replay Cache

That path is more agentic and potentially more impressive, but it is also more complex to build and debug.

## Suggested Next Step

The next useful move is not implementation yet. It is to score these architectures against a few concrete query workloads, for example:

- "find the moment where the speaker says pricing while a warning banner is visible"
- "find all screen transitions back to the dashboard"
- "show the first moment the terminal prints an error"
- "find the clip where the audience laughs after the demo fails"
- "compare when feature X appears across five product demo videos"

That will quickly expose which ideas are actually differentiated and which are just different index shapes for the same workload.
