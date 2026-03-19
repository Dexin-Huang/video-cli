# Architecture Search: Agent Instructions

**Your working directory is `D:/Projects/video-cli-auto`.**

Read `research/program.md` for the full rules. Here's the short version:

You are running an autonomous architecture search loop. Your job is to maximize the composite score by editing ONLY `research/search_arch.js` and evaluating with `node research/eval_harness.js --tag <description>`.

**Current baseline composite: 0.506. Beat it.**

## The challenge

A dense pipeline that describes every frame every 2 seconds costs $0.03/video. The sparse pipeline (59 utterances + 8 OCR items + 8 frame embeddings) costs $0.001/video. Your job is to make the sparse pipeline match or exceed the dense pipeline's retrieval quality through better ranking, fusion, span construction, and routing — not through more API calls.

The transcript already covers the full video timeline. The information is there. The search just isn't extracting the right spans from it.

## Composite score

- 30% R@1 IoU≥0.5 (did the top result land on the right moment?)
- 20% MRR (ranking quality)
- 10% R@1 IoU≥0.3 (loose recall)
- 10% simplicity (fewer lines = better, hard fail at 500 lines)
- 10% cost (cheaper = better, hard fail at $0.05/video)
- 10% speed (faster = better)
- 10% precision (return exactly top-K results, not thousands of variants)

Hard fails that cap score at 0.10: R@1 below 0.05, >80% zero-result queries, >500 lines, cost >$0.05/video.

**Span-variant carpet-bombing does not work.** The eval hard-caps at 5 results and penalizes bloat. You need real retrieval improvements.

## Failure analysis

88/140 queries currently fail (IoU < 0.3). Here's where:

**By modality (what the query asks about):**
- visual: 43 failures (49%) — "show the scene where...", "what does the diagram show..."
- ocr: 16 failures (18%) — "what is the formula...", "what score is shown..."
- cross_modal: 15 failures (17%) — needs both visual + transcript
- transcript: 13 failures (15%) — paraphrases, indirect references
- temporal: 1 failure

**By difficulty:**
- semantic: 37 — paraphrases not matched
- exact: 25 — exact OCR/text not found (wrong timestamp)
- cross_modal: 14 — needs multiple signals combined
- temporal: 12 — before/after ordering

**The core problem:** 49% of failures are visual queries. We have 8 frame embeddings spaced ~30s apart. A query about a specific visual moment often lands on the wrong frame or on a transcript utterance that's topically similar but temporally wrong.

## Available data per video

The search has access to these cached embeddings (in `data/videos/<id>/embeddings.json`):
- ~60 transcript utterance embeddings (text, with startSec/endSec timestamps)
- 8 OCR item embeddings (text, with atSec timestamps and frame paths)
- 8 watchpoint frame embeddings (image vectors, with atSec timestamps)

It also has access to raw artifact files:
- `manifest.json` — includes `sceneDetection.changePointsSec` (scene change timestamps) and `watchpoints` array
- `ocr.json` — full OCR text per watchpoint
- `transcript.json` — full utterances, words with timestamps, segments

The search does NOT currently use scene change points, word-level timestamps, or segment boundaries. These are free signals sitting unused in the manifest and transcript.

## Ideas from the architecture research (docs/video-math-architectures-50.md)

These are the most promising ideas mapped to the actual failure patterns. Read the full doc for details.

**For visual failures (49% of failures):**
- **Query-type routing (#12/#19):** Detect if query is visual ("show", "scene", "frame", "diagram") vs transcript ("explain", "say", "mention") and reweight sources accordingly. 10 lines, free.
- **Expand-around-landmark (#20):** When a frame embedding matches, also return nearby transcript utterances as supporting evidence. The watchpoints ARE landmarks — use them as anchors.
- **Load dense descriptions (#8):** `data/videos/<id>/descriptions.json` exists with frame descriptions every 2s. Loading and searching these (as text, no embedding needed) would massively improve visual recall. But this increases cost — weigh the tradeoff.

**For IoU mismatch (spans too wide or misaligned):**
- **Scene-change span snapping (#22):** Use `manifest.sceneDetection.changePointsSec` to snap result spans to natural segment boundaries instead of raw utterance boundaries. Free signal, currently ignored.
- **Query-adaptive span sizing:** Short factual queries ("what is ANN?") need tight spans (2-5s). Broad queries ("explain the cost function") need wider spans (10-20s). Size the span based on query characteristics.

**For result clustering (redundant top-5):**
- **Submodular diverse selection (#48):** Instead of top-5 by score, select results that maximize coverage of the timeline. If results 1-3 are all from the same 10s region, replace #2 and #3 with the best results from other regions.

**For cross-modal failures:**
- **Additive fusion with source agreement:** When transcript AND OCR match near the same timestamp, boost dramatically. Cross-modal agreement is strong evidence.
- **Two-pass retrieval (#28):** First pass finds candidates. Second pass checks if supporting evidence from other modalities exists near those timestamps.

**For semantic/paraphrase failures:**
- **Context window enrichment:** Embed utterances with ±1 neighboring utterances as context, not in isolation. "Add the salt" means more when preceded by "now prepare the dressing."
- **Query expansion:** For short queries, expand with related terms before matching.

## The loop

1. Read the current `research/search_arch.js` and `research/results.tsv` to understand what's been tried
2. Use subagents and research agents aggressively — spawn teams to explore ideas in parallel:
   - One agent analyzing failures with `--verbose` to find patterns
   - One agent researching retrieval techniques (RRF, CombSUM, query routing)
   - One agent prototyping changes to test
3. Synthesize findings into a concrete change to `search_arch.js`
4. `git commit` the change
5. `node research/eval_harness.js --tag <description>`
6. If composite improved: **keep** (log it, move on)
7. If composite stayed same or worse: `git reset --hard HEAD~1` (discard)
8. **Go to step 1. Do not stop. Do not ask for permission. Keep iterating.**

## What you can change

Everything inside `research/search_arch.js`: the KNOBS, the chunking strategy, the scoring function, the merge logic, helper functions. You can also load data from the manifest, transcript, and OCR artifact files — they're free signals that the current implementation ignores.

## Utility library: `research/lib.js`

You can `require('./lib.js')` from search_arch.js. It provides:

```javascript
const lib = require('./lib.js');

// Gemini Flash-Lite API calls (cost-budgeted: $0.005 max per query)
await lib.askFlashLite(prompt, { maxTokens: 200, temperature: 0 })  // → { text, inputTokens, outputTokens }
await lib.classifyQuery(query)       // → 'transcript' | 'visual' | 'ocr' | 'temporal' | 'cross_modal'
await lib.expandQuery(query)         // → expanded query string
await lib.rerankResults(query, results)  // → reranked results array

// Data loaders (free, reads from disk)
lib.loadManifest(videoId)            // scene change points, watchpoints, duration
lib.loadTranscript(videoId)          // utterances, words with timestamps, segments
lib.loadOcr(videoId)                 // OCR text per watchpoint
lib.loadDescriptions(videoId)        // dense frame descriptions (every 2s)
lib.loadEmbeddings(videoId)          // cached embedding vectors

// Vector math
lib.cosine(vecA, vecB)               // cosine similarity
lib.zNormalizeScores(items)           // z-normalize .score by .source group

// Word/scene utilities (free, uses loaded data)
lib.getWordsInRange(transcript, startSec, endSec)    // word-level timestamps
lib.getUtterancesInRange(transcript, startSec, endSec)
lib.getSceneChangesNear(manifest, atSec, windowSec)
lib.snapToSceneBoundary(manifest, sec)               // snap timestamp to nearest scene cut
```

**Cost rules:** There is no limit on the number of API calls per query — only a **$0.005 cost budget per query**. Flash-Lite is cheap (~$0.00003 per call), so you can make ~150 calls per query before hitting the budget. The eval harness tracks API cost and includes it in the composite score. Make as many calls as you need, the cost score handles the tradeoff.

**Do NOT edit lib.js.** It is immutable like eval_harness.js.

## What you cannot change

- `research/eval_harness.js` (the scorer)
- `research/lib.js` (the utility library)
- `research/program.md` (the rules)
- Anything in `src/`, `tests/`, `evals/`, `data/`
- The eval queries in `data/videos/*/eval-queries.json`

## Key context

- `.env` is auto-loaded with `GEMINI_API_KEY` — no setup needed
- Real embeddings are cached in `data/videos/*/embeddings.json` — ranking-only changes are free to eval
- Changes that affect embedding construction (chunk strategy, dimensions) need re-embedding via `node video-cli.js embed <id>` — try ranking improvements first since they're free
- The eval set is 140 queries across 7 videos (3 cooking, 1 sports, 1 lecture, 1 screen recording, 1 broadcast)
- Run `node research/eval_harness.js --tag <name> --verbose` to see per-query failures

Be ambitious. Be radical. But test everything empirically — the composite score is the only thing that matters.
