---
name: crdt-collaboration
description: >-
  Keep project truth, undo, persistence, and collaboration consistent through the
  Automerge CRDT write path. ALWAYS apply when touching executeAppAction or undo,
  CrdtDocument, CRDT-backed stores or persistence, .sdaw files, collaboration
  sessions or transports, or projections between the document and stores — even
  for a one-line store field. Skip pure presentational state, ephemeral UI, and
  engine-internal RT buffers.
---

## Purpose

Project truth is an Automerge document, not a pile of stores. One write path feeds four consumers — live stores, undo/history, persistence, and collaboration sync — so a shortcut that "just writes the store" silently breaks the other three.

## Core rules

### 1. Every project mutation goes through `executeAppAction`

Each action executes inside an Automerge storage transaction and carries a semantic context (`setSemanticContext` from CrdtDocument) that becomes its history entry. CRDT history doubles as the undo/audit log. No project-truth write outside this path — not "temporary", not "internal".

**Why:** a write that skips the transaction is invisible to undo, persistence, and merge — three features lost for the price of one shortcut.

### 2. CrdtDocument owns the document; modules own projections

Document lifecycle (create/load/save, branches, merge, semantic action history, compaction) belongs to CrdtDocument. Stores fed from the document are projections (`projection/projectProjection.ts`): derived, disposable, rebuildable — never a second truth and never patched by hand.

**Why:** two writable copies of one truth diverge; a projection you cannot throw away becomes the bug you cannot find.

### 3. The document holds serializable truth only

No `AudioContext`, nodes, worklet handles, plugin instances, or editor windows in the CRDT document or CRDT-backed stores. Runtime objects live with the engine/host (canonical: `state-and-write-paths` rule 4).

**Why:** Automerge must serialize and merge every value; a live handle can do neither.

### 4. Know the persistence layers

Browser: CRDT-backed stores persist via the Automerge storage adapter (`src/infra/store/storage/createAutomergeStorage.ts`). Native: the `daw-collab` crate reads/writes `.sdaw` bundles (magic `SDAW`, version u16, per-doc Automerge saves — `crates/daw-collab/src/persistence.rs`); TS encode/decode lives in `CrdtDocument/useCases/sdawFileFormat/`. Filesystem access goes through repositories (`nativeCrdtPersistence/`), never components.

**Why:** two formats, one document model — confusing them corrupts saves at the boundary.

### 5. Three collaboration transports, one document model

Serverless WebRTC with manual offer/answer + QR invites; the standalone `server/` WebSocket relay (separate npm package); native LAN via mDNS and `collab_*` Tauri commands. Transport/session/presence belongs to the Collaboration module; the document belongs to CrdtDocument (canonical split: `src/modules/Collaboration/AGENTS.md`).

**Why:** fixes land in the wrong layer when transport and document ownership blur.

### 6. Merges converge automatically; meaning does not

Automerge guarantees convergence of concurrent edits. It does not guarantee sensible undo or reviewable history — those come from the semantic context on each action (rule 1). When adding an action, write the label you would want in a history view.

**Why:** convergence without semantics yields a technically-consistent document nobody can explain.

## Anti-patterns

### CRITICAL — Direct store write against a CRDT-backed store

❌ Wrong: `store.set(...)` on a projected or Automerge-persisted store to "just update the UI".

✅ Correct: dispatch the owning action; let the transaction update the document and the projection refresh the store.

## References

- [docs/architecture/06-crdt-collaboration.md](../../../docs/architecture/06-crdt-collaboration.md) — full write-path and transport architecture.
- [src/modules/Collaboration/AGENTS.md](../../../src/modules/Collaboration/AGENTS.md) — the three transports in detail.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — truth/projection state model.
