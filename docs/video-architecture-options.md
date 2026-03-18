# Video CLI Architecture Options

## Purpose

This note explores distinct architectures for an agent-friendly long-video CLI. The goal is not to pick one immediately, but to widen the design space enough that we can evaluate real tradeoffs instead of circling around one default pattern.

Each option includes:

- Core mechanism
- Ingest path
- Query path
- Strengths
- Weaknesses

The options are grouped only loosely. Some can be combined. Others are mutually opinionated and should be treated as alternative foundations.

## Evaluation Axes

When comparing options, use these axes:

- Exactness: how well it answers precise timestamped questions
- Recall: how well it finds things the user cannot name exactly
- Cost: ingest and query cost
- Latency: time to first useful result
- Complexity: implementation and ops burden
- Explainability: whether the agent can show why it returned a result

## 1. Transcript FTS Baseline

- Core mechanism: transcript chunks indexed in SQLite FTS5, optionally with overlapping windows.
- Ingest path: transcribe audio, split into 10 to 20 second chunks, insert into FTS table with timestamps.
- Query path: exact search over speech, then expand to neighboring chunks and optionally extract frames nearby.
- Strengths: cheapest serious baseline, fast local search, highly explainable.
- Weaknesses: misses visual-only content, OCR text, and non-speech events.

## 2. OCR Screen Archive

- Core mechanism: OCR on shot keyframes or periodic samples to make the pixels searchable as text.
- Ingest path: detect shot boundaries, sample representative frames, run OCR, store text with frame timestamps and image paths.
- Query path: exact search over OCR text, then pull the corresponding frames or clip window.
- Strengths: strong for screen recordings, slides, terminals, dashboards, and code on screen.
- Weaknesses: brittle on low-resolution video, weak for natural scenes, does not capture motion or semantics.

## 3. Shot-Keyframe Gallery

- Core mechanism: convert the video into shots plus one or a few representative frames per shot.
- Ingest path: shot detection, keyframe extraction, shot metadata storage, optional thumbnails.
- Query path: search structural metadata first, then step through keyframes for visual inspection or downstream reasoning.
- Strengths: cheap structural backbone, compresses long video into inspectable visual anchors.
- Weaknesses: keyframes can miss transient actions and subtle motion.

## 4. Audio Event Timeline

- Core mechanism: index non-speech audio events alongside transcript.
- Ingest path: audio event detection for laughter, applause, music, silence, typing, alarms, crowd noise, and other recurring classes.
- Query path: search by event labels or use event timelines to filter candidate spans before deeper reasoning.
- Strengths: covers parts of the video that speech-only indexing misses.
- Weaknesses: labels can be coarse, event classifiers can be domain-dependent.

## 5. Visual Embedding Shot Index

- Core mechanism: one image embedding per keyframe or shot-level visual summary.
- Ingest path: extract representative frames, embed them, store vectors in a local ANN index with shot IDs.
- Query path: text-to-image or image-to-image retrieval returns candidate shots, then the CLI expands to nearby context.
- Strengths: useful for visually described queries that never appear in speech.
- Weaknesses: weaker explainability, approximate rather than exact, can miss temporal nuance.

## 6. Multimodal Segment Embeddings

- Core mechanism: fuse transcript summary, OCR text, and one or more representative frames into a single segment embedding.
- Ingest path: segment the video into 15 to 60 second windows, collect multimodal evidence for each, embed the fused content.
- Query path: semantic retrieval over segments, followed by detailed inspection of the top hits.
- Strengths: better cross-modal recall than transcript-only or frame-only search.
- Weaknesses: more expensive ingest, harder to debug, still not a substitute for exact evidence.

## 7. Object and Face Track Store

- Core mechanism: track persistent entities across time instead of storing only isolated frames.
- Ingest path: run object detection, face detection, or domain-specific detectors and stitch detections into tracks with start and end times.
- Query path: search for segments where an entity appears, disappears, or co-occurs with another entity.
- Strengths: good for recurring people, products, logos, or objects; supports temporal questions.
- Weaknesses: detector quality matters; tracking adds compute and storage overhead.

## 8. Screen State Change Engine

- Core mechanism: model the video as a sequence of interface states and state transitions.
- Ingest path: compute frame differences, OCR deltas, dominant layout signatures, and transition points.
- Query path: answer questions like "when did it switch from dashboard to settings" or "find all times the modal opened."
- Strengths: excellent for product demos and screen recordings; very cheap if based on diffs and OCR.
- Weaknesses: less useful for natural footage or human action.

## 9. Patch and Region Retrieval

- Core mechanism: index regions inside frames instead of only whole-frame representations.
- Ingest path: crop salient regions, UI panels, text blocks, or detected objects and embed or OCR them separately.
- Query path: retrieve specific regions for queries like "red warning banner" or "small chart in the upper right."
- Strengths: catches details whole-frame indexing can wash out.
- Weaknesses: high ingest complexity and more storage; region proposals can be noisy.

## 10. Storyboard Caption Index

- Core mechanism: caption sparse keyframes or shots and search the captions as a proxy for visual semantics.
- Ingest path: build a storyboard, run captioning on selected frames or shots, store captions in FTS and optionally as embeddings.
- Query path: exact and semantic retrieval over captions, then inspect the linked frames and timestamps.
- Strengths: simple mental model, useful for "what is visually happening" queries.
- Weaknesses: captioners hallucinate and often miss fine details or domain-specific cues.

## 11. Temporal Pyramid Memory

- Core mechanism: maintain multiple aligned granularities at once: fine chunks, medium segments, coarse chapters.
- Ingest path: build hierarchical windows, summaries, and links between them.
- Query path: search coarse levels first to narrow scope, then descend into fine-grained evidence.
- Strengths: scales to long videos without losing global structure.
- Weaknesses: more moving parts and possible summary drift between levels.

## 12. Query Planner Over Multiple Indices

- Core mechanism: treat transcript, OCR, audio events, visual vectors, and tracks as specialized stores behind a query planner.
- Ingest path: build several narrow indices rather than one monolithic representation.
- Query path: classify the query, route to relevant indices in parallel, merge candidates, rerank, and explain provenance.
- Strengths: adaptable, debuggable, and often the best balance of precision and recall.
- Weaknesses: orchestration logic becomes the main complexity.

## 13. Lazy Refinement Pipeline

- Core mechanism: do minimal ingest, then enrich only the spans that are actually queried.
- Ingest path: transcript plus shot boundaries only.
- Query path: search the cheap indices first, then run OCR, dense frames, captioning, or Gemini on just the top candidate windows.
- Strengths: low upfront cost, fast to ship, efficient for sparse usage.
- Weaknesses: first hit can be slower, repeated analysis may recompute the same evidence.

## 14. Whole-Video Map-Reduce Reasoner

- Core mechanism: use a long-context model to create a coarse global map, then recursively refine parts.
- Ingest path: upload the video or derived media representation and ask the model for chapters, entities, recurring motifs, and candidate timestamps.
- Query path: reason over the global map first, then re-query selected clips at higher fidelity.
- Strengths: strongest global narrative understanding.
- Weaknesses: expensive, slower, and less deterministic than local-first approaches.

## 15. Evidence Notebook

- Core mechanism: maintain a persistent notebook of claims, evidence spans, and unresolved hypotheses per video.
- Ingest path: initial indexing plus a structured store for analyst or agent observations.
- Query path: search existing evidence first, then augment only where the notebook has gaps or contradictions.
- Strengths: good for repeated analysis sessions and complex investigations.
- Weaknesses: state management becomes a product in itself.

## 16. Event DAG

- Core mechanism: represent the video as events connected by temporal and causal edges.
- Ingest path: detect candidate events, attach participants and resources, and link them with before/after, overlaps, and causes-like edges.
- Query path: run graph-style traversal for questions like "after the error appears, when does the user recover" or "what happens between introduction and conclusion."
- Strengths: supports real reasoning over sequences rather than isolated spans.
- Weaknesses: event extraction is difficult and may overfit to certain domains.

## 17. Entity Memory Graph

- Core mechanism: build a graph of people, objects, screens, topics, and references that recur across the video.
- Ingest path: extract entities from transcript, OCR, detection, and captions, then co-reference them across time.
- Query path: answer multi-hop questions through entities, such as "where does the presenter mention pricing while the roadmap slide is visible."
- Strengths: strong for cross-cutting questions that require joining multiple evidence channels.
- Weaknesses: entity resolution can be messy; graph construction adds complexity.

## 18. Timeline SQL Engine

- Core mechanism: treat the video as interval data and query it with structured temporal operators.
- Ingest path: store spans for speech, OCR, shots, object tracks, captions, and audio events in normalized interval tables.
- Query path: compile the user query into SQL or interval algebra, then materialize matching spans.
- Strengths: very precise and explainable; excellent for repeatable analyst workflows.
- Weaknesses: query translation is non-trivial, and fuzzy semantics need a second layer.

## 19. Visual Codebook Compression

- Core mechanism: cluster frames or shots into reusable visual codewords, then index sequences of codewords rather than raw frames.
- Ingest path: extract visual features, quantize them into a codebook, and store time-aligned symbol sequences.
- Query path: use symbolic pattern matching or codeword similarity to find repeated motifs and recurring scene types.
- Strengths: compact representation, good for repetition and anomaly detection.
- Weaknesses: abstract and harder to inspect directly; retrieval quality depends on the codebook.

## 20. Landmark Memory with Revisit Anchors

- Core mechanism: store only a sparse set of highly informative anchors and let the agent iteratively revisit neighboring windows.
- Ingest path: select anchor frames, anchor transcript spans, and anchor events that summarize the space of the video.
- Query path: jump between anchors, then zoom in around promising anchors until the evidence is sufficient.
- Strengths: low storage, supports exploration without full dense indexing.
- Weaknesses: quality depends on anchor selection; can miss edge cases between anchors.

## 21. Prototype Library Matching

- Core mechanism: define reusable prototypes such as "error screen," "slide transition," "terminal output," or "demo success state."
- Ingest path: extract features needed for prototype matching and assign prototype scores over time.
- Query path: match queries to prototypes first, then inspect the best spans for confirmation.
- Strengths: practical if the domain is narrow and repetitive.
- Weaknesses: weak generality; prototype authoring is manual or semi-manual.

## 22. Agentic Detective Loop

- Core mechanism: let the CLI act as an investigative tool where the agent proposes hypotheses, runs targeted probes, and narrows uncertainty over several turns.
- Ingest path: minimal baseline index plus tools for targeted extraction and inspection.
- Query path: alternate between search, inspect, frame pulls, short-clip reasoning, and note-taking until confidence is sufficient.
- Strengths: flexible and often cheaper than dense ingest because it spends effort only where needed.
- Weaknesses: requires a smart controller and good stopping criteria.

## 23. Dual-Store Local Exact Plus Cloud Rerank

- Core mechanism: keep all exact evidence local, but use a cloud multimodal model only for reranking and final synthesis.
- Ingest path: transcript, OCR, shots, frames, and local indices; optional lightweight local embeddings.
- Query path: local retrieval produces a shortlist, cloud model judges the shortlist, then the CLI returns evidence-backed results.
- Strengths: good balance of cost, privacy, and answer quality.
- Weaknesses: introduces a cloud dependency for best results.

## 24. Domain-Specific Analyzer Packs

- Core mechanism: keep a generic core but load domain packs for screen recordings, sports, lectures, surveillance, or interviews.
- Ingest path: shared baseline indexing plus domain detectors or schemas.
- Query path: planner chooses the relevant pack, which contributes domain-specific retrieval and explanation strategies.
- Strengths: strong performance when the domain is known.
- Weaknesses: more product surface area and more specialized maintenance.

## Early Evaluation

If the goal is fast, lightweight, and high-performing for a broad set of videos, the most promising foundations are:

- 12. Query Planner Over Multiple Indices
- 13. Lazy Refinement Pipeline
- 23. Dual-Store Local Exact Plus Cloud Rerank
- 11. Temporal Pyramid Memory
- 8. Screen State Change Engine for screen-recording-heavy workloads

If the goal is ambitious reasoning over complex long-form video, the most interesting but riskier options are:

- 14. Whole-Video Map-Reduce Reasoner
- 16. Event DAG
- 17. Entity Memory Graph
- 22. Agentic Detective Loop

If the goal is unusual but potentially high-leverage research territory, the most radical options are:

- 19. Visual Codebook Compression
- 20. Landmark Memory with Revisit Anchors
- 21. Prototype Library Matching

## My Current Read

The most defensible near-term architecture is not one index. It is a planner over several cheap local indices plus targeted refinement.

That suggests a staged build:

1. Transcript FTS, OCR, shots, and frames
2. Query planner and local evidence merge
3. Lazy enrichment and reranking
4. Only then, if needed, graph or long-context reasoning layers

This preserves exact evidence, keeps costs down, and still leaves room for genuinely richer reasoning later.
