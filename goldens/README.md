# Goldens

This folder is the product-aligned golden set scaffold for `video-cli`.

The north star is:

> Make a video feel like a codebase to an LLM: searchable, inspectable, citeable, and fast to drill into.

That means the golden set is not mainly for generic video QA. It is for evaluating whether the CLI can:

- find the right moment quickly
- return a tight evidence span instead of a huge chunk
- surface the right modality: transcript, OCR, frame, or clip
- support citation with timestamps and local artifacts
- stay cheap enough to use by default

## Mixed 15 Selection

The first selected set is a mixed `15` video slice:

- `8` YouCook2 videos
- `4` ActivityNet Captions videos
- `3` custom product-aligned videos

The purpose of the mix:

- `YouCook2`: dense temporal structure, short-mid videos, strong narration
- `ActivityNet Captions`: broader open-domain temporal events
- `Custom`: OCR-heavy and product-critical cases public datasets under-cover

## Required Query Families

Every selected video should support at least `4` query families.

- `transcript_exact`: exact spoken phrase retrieval
- `transcript_paraphrase`: semantic spoken-content retrieval
- `event_localization`: find the correct temporal moment
- `before_after_context`: locate immediate causal or surrounding context
- `ocr_exact`: exact visible text retrieval from frames
- `visual_state`: retrieve a scene or visual condition from non-speech evidence
- `mixed_grounding`: combine transcript and on-screen evidence

The custom videos should explicitly cover:

- scoreboard or broadcast overlays
- slides / whiteboard / chart-heavy explanation
- UI / screen recording / dense on-screen text

## Files

- `sets/mixed-15.json`: current selected 15-video composition
- `videos/`: per-video manifests as the set moves from selected to annotated
- `query-cases/`: starter or verified query cases grouped by video id
- `schema/video-manifest.schema.json`: per-video manifest schema
- `schema/query-case.schema.json`: per-query golden case schema
- `templates/video.template.json`: starter per-video manifest
- `templates/query-case.template.json`: starter query case
- `validate.js`: structural validator for the set manifest

## Workflow

1. Review or adjust the `15` chosen videos in `sets/mixed-15.json`.
2. Create one per-video manifest from `templates/video.template.json`.
3. Add query cases using `templates/query-case.template.json`.
4. Promote seeded cases to verified cases after local ingest and artifact review.
5. Convert those into executable eval suites.

## Validation

```powershell
npm run goldens:check
```

Machine-readable output:

```powershell
npm run goldens:check:json
```

Executable grounded evals:

```powershell
npm run goldens:eval
```
