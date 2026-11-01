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

## Rules

### 1. Every project mutation goes through `executeAppAction`

Each action executes inside an Automerge storage transaction and carries a semantic context (`setSemanticContext` from CrdtDocument) that becomes its history entry; that history is also the undo/audit log. No project-truth write outside this path — not "temporary", not "internal".

**Why:** a write that skips the transaction is invisible to undo, persistence, and merge — three features lost for the price of one shortcut.

**Enforced by:** `src/modules/Command/useCases/__tests__/executeAppAction.spec.ts` and `executeAppActionAbortRollback.spec.ts` for the transaction and abort contract; a bypassing write is review only.

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

### 4. Dispatch the owning action; never `store.set` a CRDT-backed store

A `store.set(...)` on a projected or Automerge-persisted store "to just update the UI" is a defect. Dispatch the owning action; the transaction updates the document and the projection refreshes the store.

**Why:** a direct store write bypasses rule 1: the document, undo, persistence, and collaboration never see it.

**Enforced by:** ESLint `sourdaw/no-foreign-store-write` (warn) for foreign stores only; a write to a module's own CRDT-backed store is review only.

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

Automerge guarantees convergence of concurrent edits. It does not guarantee sensible undo or reviewable history — those come from the semantic context on each action (rule 1). When adding an action, write the label you would want in a history view.

**Why:** convergence without semantics yields a technically-consistent document nobody can explain.

**Enforced by:** `src/modules/Command/useCases/__tests__/actionLabels.spec.ts` for the label map; label quality is review only.

## References

- Review probes for this area: `../review-stances/project-integrity.md`, `../review-stances/replay-authority.md`, `../review-stances/session-lifecycle.md` and `../review-stances/collaboration-teardown.md`.
- [docs/architecture/06-crdt-collaboration.md](../../../docs/architecture/06-crdt-collaboration.md) — full write-path and transport architecture.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — truth/projection state model.
