---
type: adr
id: 0013
title: Agent pure transactions and external-effect sagas
status: accepted
date: 2026-07-26
owner: The Sourdaw team
sources:
  - DECISIONS-sourdaw-agentic-production-system D-011 and D-012
  - SPEC-sourdaw-agentic-production-system AC-014 and AC-016
---

# 0013 — Agent pure transactions and external-effect sagas

## Context

Notification batching is not atomic persistence, and a project edit cannot make
independently durable file, provider, render, install, or publish work atomic.

## Decision

Pure same-document project batches preflight completely and commit as one logical
edit. Cross-document pure batches require the CRDT persistence owner's
rollback-capable prepare/commit/finalize mechanism; until it exists, they remain
preview-only or split into explicitly approved sagas.

Irreversible or independently durable effects are receipt-bearing saga steps with
retry, cancellation, cleanup, and compensation. A saga may finish
`partially-completed`, but every completed or failed step remains visible.

## Consequences

- Partial persistence is never described as pure-batch success.
- External effects cannot hide inside a project transaction.
- Cross-document atomicity remains owned by the CRDT persistence campaign.
