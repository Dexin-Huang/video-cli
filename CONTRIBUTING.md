# Contributing

## Quick Start

```bash
git clone https://github.com/Dexin-Huang/video-cli
cd video-cli
cp .env.example .env  # add your GEMINI_API_KEY
npm test              # test suite
```

Keep [README.md](README.md), [SKILL.md](SKILL.md), and the command help in `src/cli.js` aligned when changing user-facing behavior.

## Adding a Provider

1. Create `src/lib/your-provider.js` exporting `createYourProvider()` that returns `{ transcribeAudio() }` or `{ ocrImage() }`.
2. Add a `case` in `src/commands/pipeline.js` `createProvider()`.
3. Add mock mode: check `process.env.VIDEO_CLI_MOCK_YOURPROVIDER === '1'`.
4. Run `npm test`.

## Pull Requests

- One change per PR.
- All tests must pass.
- No new npm dependencies without discussion.
- Keep release-facing docs current: `README.md`, `CHANGELOG.md`, and any touched templates.
