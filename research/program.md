# video-cli architecture search

## Goal

Maximize retrieval quality on a pinned eval set of 140 queries across 7 videos.

The metric is a composite of:
- **R@1 IoU≥0.5**: fraction of queries where the top result overlaps ≥50% with the ground truth time span
- **MRR**: mean reciprocal rank of the first correct result (IoU≥0.3)
- **Composite**: `0.5 * R@1_IoU>=0.5 + 0.5 * MRR`

Current baseline: **composite = 0.2681** (R@1=0.24, MRR=0.29)

## The three files

| File | Role | Editable? |
|---|---|---|
| `research/search_arch.js` | Architecture: embedding strategy, chunking, scoring, ranking | **YES — this is the only file you edit** |
| `research/eval_harness.js` | Eval: loads pinned eval set, computes IoU/MRR metrics | **NO — never edit** |
| `research/program.md` | These instructions | **NO — never edit** |

## Setup

Make sure you're on a branch:
```bash
git checkout -b autoresearch/<tag>
```

Run the baseline to confirm your starting point:
```bash
node research/eval_harness.js --tag baseline
```

Confirm the composite score matches the known baseline (~0.2681).

## The loop

Repeat forever:

### 1. Review current state
```bash
git diff research/search_arch.js
cat research/results.tsv
```

### 2. Edit `research/search_arch.js`

Change one thing at a time. Ideas to try:
- Filter short utterances (set `minWordCount` or `minTextLength`)
- Switch chunk strategy to `sliding_window` with different window sizes
- Enable `lengthBoostEnabled` and tune `lengthBoostFactor`
- Enable `ocrContextEnabled` to enrich OCR with transcript context
- Adjust `lexicalBaseScore`, `semanticWeight`, `lexicalWeight`
- Change `dedupeWindowSec`
- Reduce `dimensions` (256, 384)
- Disable `framesEnabled` to test text-only search

### 3. Commit
```bash
git add research/search_arch.js
git commit -m "<short description of what changed>"
```

### 4. Run eval
```bash
node research/eval_harness.js --tag "<description>"
```

### 5. Check results
Look at the COMPOSITE SCORE printed at the end.

### 6. Keep or discard

**If composite improved:**
```bash
# Keep it — the branch advances
echo "KEEP: <score> — <description>"
```

**If composite stayed the same or got worse:**
```bash
git reset --hard HEAD~1
echo "DISCARD: <score> — <description>"
```

### 7. Go to step 1

## Rules

1. **Only edit `research/search_arch.js`.** Do not edit `eval_harness.js`, `program.md`, or any file in `src/`.
2. **Do not edit the eval set.** The ground truth in `data/videos/*/eval-queries.json` is immutable.
3. **One change at a time.** Make it easy to attribute improvements.
4. **Do not stop.** Keep iterating until manually interrupted.
5. **Log everything.** `results.tsv` is your experiment log. Every run appends a row.
6. **Prefer simplicity.** A 0.01 improvement from a clean change beats a 0.02 improvement from a 50-line hack.

## What you can change in search_arch.js

- The `KNOBS` object (any values)
- The `buildSearchEmbeddings` function (chunking strategy, filtering, enrichment)
- The `rankAndMerge` function (scoring, weighting, deduplication)
- Helper functions (add new ones, modify existing ones)
- The overall algorithm and approach

## What you cannot change

- The eval harness, metrics, or thresholds
- The eval queries or ground truth spans
- The embedding API (it's either real cached embeddings or mock vectors)
- Files outside `research/search_arch.js`

## Eval data

The eval set consists of 7 videos with 20 auto-generated queries each:
- **3 cooking videos** (transcript-heavy, narrated recipes)
- **1 sports video** (visual-heavy, shot put practice)
- **1 lecture video** (mixed, neural networks explainer)
- **1 screen recording** (OCR-heavy, Adobe XD tutorial)
- **1 broadcast** (mixed, Korea WBC baseball)

Query types: exact, semantic, visual, cross_modal, temporal

## Important note on mock vs real embeddings

The eval harness checks if real embeddings (from actual Gemini API calls) exist in `data/videos/*/embeddings.json`. If they do, it uses those for accurate scoring. If not, it falls back to mock vectors which test the structure/ranking logic but not semantic quality.

For real-embeddings eval, first run `node video-cli.js embed <id>` on each video. The current baseline scores are from real embeddings.

When you change KNOBS that affect embedding construction (like `chunkStrategy`, `minWordCount`, `dimensions`), the cached embeddings won't reflect your changes — they were built with the original strategy. In that case, you'd need to re-embed. For knobs that only affect ranking (`lengthBoostEnabled`, `lexicalBaseScore`, `dedupeWindowSec`, etc.), cached embeddings are fine.
