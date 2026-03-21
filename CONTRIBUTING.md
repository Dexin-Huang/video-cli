# Contributing

## Quick Start

```bash
git clone https://github.com/Dexin-Huang/video-cli
cd video-cli
cp .env.example .env  # add your GEMINI_API_KEY
npm test              # runs 16 tests, no API calls needed
```

## Adding a Provider

1. Create `src/lib/your-provider.js` — export `createYourProvider()` returning `{ transcribeAudio() }` or `{ ocrImage() }`
2. Add a `case` in `src/commands/pipeline.js` `createProvider()` function
3. Add mock mode: check `process.env.VIDEO_CLI_MOCK_YOURPROVIDER === '1'`
4. Run `npm test` to verify

## Pull Requests

- One change per PR
- All 16 tests must pass
- No new npm dependencies without discussion
