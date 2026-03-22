# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project aims to follow Semantic Versioning.

## [Unreleased]

- Ongoing polish and maintenance.

## [0.3.0] - 2026-03-22

### Changed
- Simplified the product around the Gemini-only path for OCR, transcription, embeddings, and ask.
- Removed bundled Deepgram and ElevenLabs providers from the open-source repo.
- Kept the shipping repo focused on the product surface by dropping duplicated eval/golden material.

## [0.2.2] - 2026-03-22

### Fixed
- Stabilized CI by fixing the adaptive watchpoint integration test so the release line matches actual runtime behavior.

## [0.2.1] - 2026-03-22

### Added
- Multi-OS CI coverage across Ubuntu, Windows, and macOS.
- Skill-doc sync checks to keep the bundled agent docs aligned.
- CLI help coverage for user-facing command drift.

### Changed
- Reworked the README around product positioning, install flow, and onboarding.
- Hardened the publish workflow with test and package verification steps.

## [0.2.0] - 2026-03-22

### Added
- Production-oriented release line for the zero-dependency video CLI.
- Secure `init` flow for API-key setup.
- `cleanup` support for removing local artifacts and credentials.
- Claude Code skill installation support.
- GitHub Actions CI, publish workflow, and repository policy files.

### Changed
- Moved to a Gemini-first default path for OCR, transcription, and embeddings.
- Parallelized the setup pipeline and improved scene detection/watchpoint selection.
- Reduced codebase complexity while keeping the command surface intact.
