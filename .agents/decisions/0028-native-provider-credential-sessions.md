---
type: adr
id: 0028
title: Hosted provider credentials stay native behind opaque sessions
status: accepted
date: 2026-08-29
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

**Accepted 2026-08-29.** This supersedes the browser-held credential and browser-hosted transport
parts of architecture ADR 0013, replaces this ADR's former environment-variable acquisition
mechanism, and narrows ADR 0035. Their historical bodies remain unchanged.

## Context

Provider keys are secrets. Sending one through renderer state or IPC exposes it to the least trusted
application layer. Tauri permissions constrain command access; they do not make a secret copied into
the webview safe.

## Decision

Hosted providers are desktop-only. The Preferences password-input draft is sent once to native when
opening a provider session. Native validates the credential source, adapter, and origin together,
stores the credential in a bounded volatile zeroizing session, and returns an opaque session ID.
After that configuration call, the renderer sends only a session ID, model input, and a compiled
operation. Credentials are not stored in Preferences, project state, status stores, logs, chat, or
collaboration data.

First-party credentials are bound to their first-party origins. Custom HTTPS providers can use only
the dedicated OpenAI-compatible credential. The gateway fixes paths, rejects redirects and proxies,
pins public DNS results, bounds traffic, and never logs credentials or provider bodies.

Closing or replacing a configuration aborts frontend-owned requests and destroys its native session.
Sessions are never persisted. Web builds expose no hosted-provider credential surface. Explicit
unauthenticated loopback OpenAI-compatible endpoints may remain renderer-local because they carry no
secret. Restarting Sourdaw destroys every session, so credentialed providers require a new entry.

## Consequences

- Desktop users enter a first-party key in Preferences when creating the session. The draft clears
  after success and when its provider changes or is removed. OpenAI-compatible endpoints may omit a
  credential only when that endpoint explicitly permits unauthenticated requests.
- Adding a provider protocol requires compiled native and repository adapters.
- Browser WebLLM remains available without credentials or remote fallback.
- The renderer may carry a credential only in the local password draft and the one session-opening
  call; it cannot retain, expose, redirect, or reuse it afterwards.
