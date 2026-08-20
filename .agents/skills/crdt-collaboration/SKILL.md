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

Project truth is an Automerge document, not a pile of stores. One write path feeds live stores, undo/history, persistence, and collaboration sync, so a shortcut that "just writes the store" silently breaks the rest.

## Core rules

### 1. Every project mutation goes through `executeAppAction`

Each action executes inside an Automerge storage transaction and carries a semantic context (`setSemanticContext` from CrdtDocument) that becomes its history entry; that history is also the undo/audit log. No project-truth write outside this path — not "temporary", not "internal".

**Why:** a write that skips the transaction is invisible to undo, persistence, and merge — three features lost for the price of one shortcut.

#### The transaction is ambient only until the handler's first `await`

`runWithAutomergeStorageTransaction` installs the transaction for the **synchronous** execution of the handler. An `async` handler returns its promise at its first `await`, and the transaction is uninstalled right there. Every CRDT-backed store write the handler makes **after** that await runs unscoped: it gets its own commit owner and its own animation frame, so it is **not** part of the action's atomic commit and **survives an abort that should have discarded it**.

Capture the scope **synchronously, before the await**, and re-enter it for the later writes:

```ts
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';

export async function commitSomething(input: Input): Promise<void> {
    const scope = captureAutomergeStorageTransactionScope();
    const rendered = await render(input);
    scope(() => {
        trackStore.set(rendered);
    });
}
```

Capture is explicit rather than implicit because browsers have no async context propagation: holding the transaction across an `await` would also capture writes made by unrelated code in that window, and this app dispatches many actions without awaiting them. Worked example: `src/modules/Knead/useCases/pitch/commitPitchEdit.ts`.

**`scope(callback)` takes a synchronous callback.** It restores the previous ambient transaction in a `finally` that runs as soon as the callback's synchronous portion returns — for an `async` callback, at its first `await`. Awaiting inside `scope` reproduces the exact bug `scope` exists to fix; the block above is the correct shape.

```ts
// ❌ the await inside scope re-opens the same hole
scope(async () => {
    const rendered = await render(input);
    trackStore.set(rendered); // unscoped again
});
```

Two writes separated by an `await` need two `scope(...)` calls, one per synchronous run.

**Both mistakes fail silently.** Capturing _after_ an `await` finds no active transaction and returns a pass-through; awaiting _inside_ `scope` un-scopes at that await. Neither raises an error, fails a type check, or trips lint — the code looks fixed and behaves exactly as it did before. Audit finding CC-10 tracks the handlers still awaiting conversion, and proposes making the second case loud with a dev-mode assertion when the callback returns a thenable.

### 2. CrdtDocument owns the document; modules own projections

Document lifecycle — create/load/save, branches, merge, semantic action history, compaction — belongs to CrdtDocument. Stores fed from the document are projections (`src/modules/CrdtDocument/useCases/projection/projectProjection.ts`): derived, disposable, rebuildable; never a second truth and never patched by hand.

**Why:** two writable copies of one truth diverge; a projection you cannot throw away becomes the bug you cannot find.

### 3. The document holds serializable truth only

No `AudioContext`, nodes, worklet handles, plugin instances, or editor windows in the CRDT document or CRDT-backed stores. Runtime objects live with the engine/host (canonical: `state-and-write-paths` rule 4).

**Why:** Automerge must serialize and merge every value; a live handle can do neither.

### 4. Know the persistence layers

Browser: CRDT-backed stores persist via the Automerge storage adapter (`src/infra/store/storage/createAutomergeStorage.ts`). Native: the `daw-collab` crate reads and writes `.sdaw` bundles — magic `SDAW`, version u16, per-doc Automerge saves (`crates/daw-collab/src/persistence.rs`); TS encode/decode lives in `CrdtDocument/useCases/sdawFileFormat/`. Filesystem access goes through repositories (`nativeCrdtPersistence/`), never components.

**Why:** two formats, one document model — confusing them corrupts saves at the boundary.

### 5. Transports vary; the document model does not

Transport, session, and presence belong to the Collaboration module; the document belongs to CrdtDocument. That split, and the transports themselves, are canonical in [src/modules/Collaboration/AGENTS.md](../../../src/modules/Collaboration/AGENTS.md).

**Why:** fixes land in the wrong layer when transport and document ownership blur.

### 6. Merges converge automatically; meaning does not

Automerge guarantees convergence of concurrent edits. It does not guarantee sensible undo or reviewable history — those come from the semantic context on each action (rule 1). When adding an action, write the label you would want in a history view.

**Why:** convergence without semantics yields a technically-consistent document nobody can explain.

## Anti-patterns

### CRITICAL — Direct store write against a CRDT-backed store

❌ `store.set(...)` on a projected or Automerge-persisted store to "just update the UI".

✅ Dispatch the owning action; the transaction updates the document and the projection refreshes the store.

## References

- [docs/architecture/06-crdt-collaboration.md](../../../docs/architecture/06-crdt-collaboration.md) — full write-path and transport architecture.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — truth/projection state model.
