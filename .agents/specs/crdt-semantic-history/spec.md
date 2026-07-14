---
type: spec
id: SPEC-crdt-semantic-history
title: CRDT semantic history and compensating undo
status: draft
owner: The Sourdaw team
sources:
  - self
---

# CRDT semantic history and compensating undo

## Intent

Let a single-player user inspect project history by intent and revert one earlier action
without rewinding unrelated later work, building on the existing Automerge semantic-change
substrate.

## Non-goals

- Multi-user real-time collaboration.
- Replacing Automerge or the single-root storage model.
- Multi-document lazy loading (a separate concern).
- History-panel theming or keyboard-shortcut design beyond the general UX system.

## Requirements

### AC-001 — Compensating undo inverts one intent at HEAD

When the user reverts a recorded change, the system must apply a new semantic inverse change
at the current head that undoes only that intent, leaving later unrelated work intact.

Verify with: `pnpm test:run -- revertSemanticAction`

### AC-002 — The history panel lists every semantic change

The panel must render the message, actor, timestamp, and affected object for each semantic
change in the journal.

Verify with: `pnpm test:run -- CrdtHistory`

### AC-003 — A linear undo stack stays available in parallel

The everyday "undo last action" stack must remain operable alongside the semantic history
panel.

Verify with: `pnpm test:run -- CrdtHistory`

### AC-004 — The semantic journal is bounded

The history journal must cap its entry count per document and archive the oldest entries to
a sidecar ledger once the cap is exceeded.

Verify with: `pnpm test:run -- CrdtHistory`

### AC-005 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-006 — Journal entries are keyed by document ID and change hash

Each semantic history journal entry must be uniquely keyed by its document ID combined with
its change hash, so an entry maps deterministically to the document and Automerge change it
records.

Verify with: `pnpm test:run -- CrdtHistory`

### AC-007 — Top-level actions propagate semantic context to CRDT writes

Every top-level app action that mutates CRDT-backed state must establish its semantic context
before execution, and the Automerge storage write cycle must consume that context when it records
the resulting change. Attribution must flow through the normal action and storage boundaries rather
than through a parallel wrapper around each `store.set()` call.

Verify with: `pnpm test:run src/modules/Command/useCases/__tests__/executeAppAction.spec.ts src/infra/store/storage/__tests__/createAutomergeStorage.spec.ts`

## Open questions

- [ ] (non-blocking) Maximum journal size before pruning. Proposal: cap at 10,000 entries per document, archive oldest to a sidecar ledger.

## Affected areas

- `src/modules/CrdtHistory/useCases/revertSemanticAction.ts`
- `src/modules/CrdtHistory/` (history panel view + store)
- `src/modules/CrdtDocument/` semantic change context

## Dropped from sources

- Universal automatic inversion of arbitrary historical low-level Automerge changes — compensating undo applies a forward semantic inverse instead, which is tractable and safe.
- A parallel "wrap every store.set" helper — the established thread-local semantic context is reused (recorded as a finding).
