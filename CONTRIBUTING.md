# Contributing

## Quick Start

```bash
git clone https://github.com/Dexin-Huang/video-cli
cd video-cli
cp .env.example .env  # add your GEMINI_API_KEY
npm test              # unit + contract + integration tests with mocked APIs
npm run smoke:pack    # packaged-install smoke test
```

Keep [README.md](README.md), [SKILL.md](SKILL.md), and the command help in `src/cli.js` aligned when changing user-facing behavior. Run `npm run skills:check` to verify the installable skill copy is in sync.

When you change user-facing JSON or help output, update the checked-in CLI contracts in `contracts/` and make sure `npm test` still passes.

## Adding a Provider

1. Create `src/lib/your-provider.js` exporting `createYourProvider()` that returns `{ transcribeAudio() }` or `{ ocrImage() }`.
2. Add a `case` in `src/commands/pipeline.js` `createProvider()`.
3. Add mock mode: check `process.env.VIDEO_CLI_MOCK_YOURPROVIDER === '1'`.
4. Run `npm test` and `npm run smoke:pack`.

## Pull Requests

- One change per PR.
- All tests and smoke checks must pass.
- No new npm dependencies without discussion.
- Keep release-facing docs current: `README.md`, `CHANGELOG.md`, and any touched templates.
