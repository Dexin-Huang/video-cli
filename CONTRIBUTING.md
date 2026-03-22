# Contributing

## Quick Start

```bash
git clone https://github.com/Dexin-Huang/video-cli
cd video-cli
cp .env.example .env  # add your GEMINI_API_KEY
npm test              # runs 20 tests, no API calls needed
```

Keep [README.md](README.md), [SKILL.md](SKILL.md), and the command help in `src/cli.js` aligned when changing user-facing behavior. Run `npm run skills:check` to verify the installable skill copy is in sync.

## Adding a Provider

1. Create `src/lib/your-provider.js` — export `createYourProvider()` returning `{ transcribeAudio() }` or `{ ocrImage() }`
2. Add a `case` in `src/commands/pipeline.js` `createProvider()` function
3. Add mock mode: check `process.env.VIDEO_CLI_MOCK_YOURPROVIDER === '1'`
4. Run `npm test` to verify

## Pull Requests

- One change per PR
- All 20 tests must pass
- No new npm dependencies without discussion
