# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/Dexin-Huang/video-cli/security/advisories/new).

Do not open a public issue for security vulnerabilities.

## Scope

- API key handling (`.env` files, environment variables)
- ffmpeg command injection vectors
- JSON parsing safety
- File path traversal in frame/clip extraction

## API Keys

video-cli reads API keys from environment variables or `.env` files. Keys are never logged, stored in artifacts, or transmitted beyond the intended API endpoints.
