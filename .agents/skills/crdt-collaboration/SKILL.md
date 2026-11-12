---
name: crdt-collaboration
description: >-
    Keep project truth, undo, persistence, and collaboration consistent through the
    Automerge CRDT write path. ALWAYS apply when touching the document write path —
    `executeAppAction` transactions, re-entering the transaction scope after an
    `await`, undo inverses and `describe()`, projections between the document and
    stores, CrdtDocument persistence and `.sdaw` files, or collaboration sessions and
    transports. Skip classifying a value or choosing its owner (state-and-write-paths),
    import and layer placement (architecture), ephemeral UI, and engine-internal RT
    buffers.
---

## Purpose

Project truth is an Automerge document, not a pile of stores. One write path feeds live stores, undo/history, persistence, and collaboration sync, so a shortcut that "just writes the store" silently breaks the rest.

## Rules

### 1. Every project mutation goes through `executeAppAction`

Each action executes inside an Automerge storage transaction and carries a semantic context (`setSemanticContext` from CrdtDocument) that labels its Automerge change. No project-truth write outside this path — not "temporary", not "internal". A dispatch a person triggered enters through `executeUserAppAction` rather than a bare `executeAppAction` call (canonical: `ui-patterns` rule 8); programmatic, agent, and handler dispatch use `executeAppAction` directly.

Undo is not Automerge history. It is an inverse-action stack beside the document: an undoable handler's `describe()` runs before `execute()` and returns the inverse `AppAction`; after the transaction commits, `executeAppAction` pushes the pair onto `undoStore`, and `undo` replays the inverse through `executeAppAction` with `skipUndo`, so an undo is itself an ordinary document write. State the document does not hold (audio buffers, for example) gets a callback entry through `pushUndoEntry`. The semantic context only labels the change; `actionHistoryStore` holds labelled entries without inverses and never serves as the undo log.

**Why:** a write that skips the transaction is invisible to undo, persistence, and merge — three features lost for the price of one shortcut. An inverse is captured only by the handler that knows the state it overwrites; no document history can reconstruct it after the fact.

**Enforced by:** `src/modules/Command/useCases/__tests__/executeAppAction.spec.ts` (transaction contract, and `describe()` running before `execute()` with undo recorded only after it resolves), `executeAppActionAbortRollback.spec.ts` for abort, and `undo.spec.ts` (the inverse replays with `skipUndo`); a bypassing write is review only.

### 2. Re-enter the transaction scope after an `await`

`runWithAutomergeStorageTransaction` installs the transaction for the **synchronous** execution of the handler only. Capture the scope synchronously, before the first `await`, and re-enter it for each later write:

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

`scope(callback)` takes a synchronous callback; never `await` inside it. Two writes separated by an `await` need two `scope(...)` calls. Worked example: `src/modules/Knead/useCases/pitch/commitPitchEdit.ts`.

**Why:** a write after the first `await` is unscoped: it commits on its own and survives an abort that should have discarded it. Capturing after an `await`, or awaiting inside `scope`, fails silently — no error, type failure, or lint hit. Capture is explicit because browsers have no async context propagation. A dev-mode thenable assertion cannot catch the second case, because the action dispatchers legitimately pass `() => handler.execute(...)` to `scope` to run a handler's synchronous portion in the transaction.

**Enforced by:** `src/modules/Command/useCases/__tests__/executeAppActionAsyncTransaction.spec.ts` for the scoped-write contract; capturing after an `await` or awaiting inside `scope` is review only.

### 3. CrdtDocument owns the document; modules own projections

Document lifecycle — create/load/save, branches, merge, semantic action history, compaction — belongs to CrdtDocument. Stores fed from the document are projections (`src/modules/CrdtDocument/useCases/projection/projectProjection.ts`): derived, disposable, rebuildable; never a second truth and never patched by hand.

**Why:** two writable copies of one truth diverge; a projection you cannot throw away becomes the bug you cannot find.

**Enforced by:** `src/modules/CrdtDocument/useCases/projection/__tests__/projectionIsReadOnly.spec.ts` (a projection pass writes to the document only in slots declaring `derivedFromSiblingSlot`); the rest is review only.

### 4. Only the owner's write path, inside a transaction, writes a CRDT-backed store

A CRDT-backed (projected or Automerge-persisted) store is written only by its owning module's write path — a handler or use case — while that write runs inside an action's transaction: the synchronous part of `executeAppAction`, or a `scope(...)` captured before the first `await` (rule 2). Everywhere else, dispatch the owning action; the transaction updates the document and the projection refreshes the store. A `store.set(...)` from presentation, from a foreign module, or outside any action transaction "to just update the UI" is the defect. Canonical statement: `state-and-write-paths` rule 3.

**Why:** a write outside the owner's transaction bypasses rule 1: the document, undo, persistence, and collaboration never see it.

**Enforced by:** ESLint `sourdaw/no-foreign-store-write` (error) for foreign stores only; an owner's write outside a transaction is review only.

### 5. The document holds serializable truth only

No `AudioContext`, nodes, worklet handles, plugin instances, or editor windows in the CRDT document or CRDT-backed stores. Runtime objects live with the engine/host (canonical: `state-and-write-paths` rule 4).

**Why:** Automerge must serialize and merge every value; a live handle can do neither.

**Enforced by:** review only.

### 6. Know the persistence layers

Browser: CRDT-backed stores persist via the Automerge storage adapter (`src/infra/store/storage/createAutomergeStorage.ts`). Native: the `daw-collab` crate reads and writes `.sdaw` bundles — magic `SDAW`, version u16, per-doc Automerge saves (`crates/daw-collab/src/persistence.rs`); TS encode/decode lives in `CrdtDocument/useCases/sdawFileFormat/`. Filesystem access goes through repositories (`nativeCrdtPersistence/`), never components.

**Why:** two formats, one document model — confusing them corrupts saves at the boundary.

**Enforced by:** `src/modules/CrdtDocument/useCases/sdawFileFormat/__tests__/sdawCrossLanguageConformance.spec.ts` and `sdawRoundTrip.spec.ts` for the format; dependency-cruiser `usecases-only-write-boundary-to-repositories` and `presentation-no-direct-repositories` for the repository boundary.

### 7. Persisted-asset ownership is not navigation metadata

For persisted assets, trace the authoritative record read and its failure semantics, and keep a complete ownership census protected through the destructive transaction's commit or abort.

**Why:** releasing protection after the read admits a stale-census delete while another renderer publishes the owner.

**Enforced by:** review only.

### 8. Transports vary; the document model does not

Transport, session, and presence belong to the Collaboration module; the document belongs to CrdtDocument. That split, and the transports themselves, are canonical in [src/modules/Collaboration/AGENTS.md](../../../src/modules/Collaboration/AGENTS.md).

**Why:** fixes land in the wrong layer when transport and document ownership blur.

**Enforced by:** review only.

### 9. Merges converge automatically; meaning does not

Automerge guarantees convergence of concurrent edits. It does not guarantee sensible undo or reviewable history. Sensible undo comes from the inverse each undoable handler's `describe()` returns (rule 1); readable history comes from the action's semantic context and its label. When adding an action, return an exact inverse from `describe()` and write the label you would want in a history view.

**Why:** convergence without semantics yields a technically-consistent document nobody can explain.

**Enforced by:** `src/modules/Command/useCases/__tests__/actionLabels.spec.ts` for the label map; inverse exactness and label quality are review only.

## References

- Review probes for this area: `../review-stances/project-integrity.md`, `../review-stances/replay-authority.md`, `../review-stances/session-lifecycle.md` and `../review-stances/collaboration-teardown.md`.
- [docs/architecture/06-crdt-collaboration.md](../../../docs/architecture/06-crdt-collaboration.md) — full write-path and transport architecture.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — truth/projection state model.
