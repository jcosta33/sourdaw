---
type: adr
id: 0028
title: Hosted provider credentials stay native behind opaque sessions
status: accepted
date: 2026-08-17
owner: The Sourdaw team
sources:
    - https://platform.openai.com/docs/api-reference/authentication
    - https://docs.anthropic.com/en/api/getting-started
    - https://v2.tauri.app/security/capabilities/
    - https://v2.tauri.app/security/runtime-authority/
    - https://v2.tauri.app/concept/inter-process-communication/
    - docs/architecture/decisions/0013-client-side-hosted-llm-adapters.md
    - docs/architecture/decisions/0035-privileged-model-provider-extensions.md
---

# 0028 — Hosted provider credentials stay native behind opaque sessions

**Accepted 2026-08-17.** This supersedes the browser-held credential and browser-hosted transport
parts of architecture ADR 0013 and narrows ADR 0035. Their historical bodies remain unchanged.

## Context

Provider keys are secrets. Sending one through renderer state or IPC exposes it to the least trusted
application layer. Tauri permissions constrain command access; they do not make a secret copied into
the webview safe.

## Decision

Hosted providers are desktop-only. Native code reads credentials from fixed environment variables,
stores them in bounded volatile sessions, and returns opaque session IDs. The renderer sends only a
session ID, model input, and a compiled operation.

First-party credentials are bound to their first-party origins. Custom HTTPS providers can use only
the dedicated OpenAI-compatible credential. The gateway fixes paths, rejects redirects and proxies,
pins public DNS results, bounds traffic, and never logs credentials or provider bodies.

Closing or replacing a configuration aborts frontend-owned requests and destroys its native session.
Sessions are never persisted. Web builds expose no hosted-provider credential surface. Explicit
unauthenticated loopback OpenAI-compatible endpoints may remain renderer-local because they carry no
secret.

## Consequences

- Desktop users set `SOURDAW_ANTHROPIC_API_KEY`, `SOURDAW_OPENAI_API_KEY`, or
  `SOURDAW_OPENAI_COMPATIBLE_API_KEY` before launch.
- Adding a provider protocol requires compiled native and repository adapters.
- Browser WebLLM remains available without credentials or remote fallback.
- The renderer cannot read, store, transmit, or redirect a hosted-provider credential.
