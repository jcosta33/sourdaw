---
type: adr
id: 0015
title: Agent run retention policy
status: accepted
date: 2026-07-26
owner: The Sourdaw team
sources:
  - DECISIONS-sourdaw-agentic-production-system D-036
  - SPEC-sourdaw-agentic-production-system AC-052 and AC-058
---

# 0015 — Agent run retention policy

## Context

Agent records span durable project decisions, operational summaries, sensitive
provider data, optional local history, and temporary artifacts. One indefinite
retention rule would either lose project history or retain private data too long.

## Decision

Canonical semantic receipts and production-brief decisions follow
project/history retention. Runtime terminal summaries retain at most 2,000
records or seven days. Raw provider bodies are not retained by default; optional
local prompt/response history defaults to seven days. Temporary renders and
uploads default to 24 hours unless accepted as assets.

Every category is user-removable, subject only to live project references.

## Consequences

- Retention is category-owned, bounded, and visible.
- Diagnostics cannot inherit indefinite local-storage retention.
- Accepted assets and referenced project history follow their owning lifecycle.
