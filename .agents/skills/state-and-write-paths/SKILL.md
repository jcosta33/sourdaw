---
name: state-and-write-paths
description: >-
    Classify every state value into one state category and choose its owning write
    path before adding or changing state. ALWAYS apply when adding, editing, or
    reviewing where a value lives — project truth, stores, selectors/projections,
    commands, events, async fetch/cache state, UI state, runtime state, or
    telemetry — and who may write it, even if it looks like "just one more store
    field". Skip transaction, undo, and persistence mechanics (crdt-collaboration),
    import and layer placement (architecture), pure presentational props with no
    persistence, and engine-internal RT buffers.
---

## Purpose

Unclassified state is how DAW truth corrupts: a store field that is half project / half UI, a foreign slice write that breaks undo, a React handle sitting where serialized truth belongs. Classify first, then place the write.

## Rules

### 1. Classify every value into exactly one category before placing it

| Category          | What it is                                                                                           | Write path                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Project state     | Authoritative truth (tracks, clips, routing, automation, tempo, markers, device order, saved params) | Owning domain use cases / commands; serializable, undoable |
| Shared runtime    | App-wide runtime visibility (engine ready, device lists, scan results)                               | Owning subsystem; not project truth                        |
| Persistent UI     | Local prefs (zoom, layout, sidebar)                                                                  | Prefs storage — not the project file                       |
| Ephemeral UI      | Selection, tool, drag, hover                                                                         | Feature/view; disposable                                   |
| Local component   | Draft input, popover open                                                                            | `useState` / form in that component                        |
| Engine/runtime    | `AudioContext`, audio nodes, live graph, plugin instances                                            | Engine/runtime only — non-serializable                     |
| Async fetch/cache | Server/query results                                                                                 | TanStack Query or equivalent — not business writes         |
| Telemetry         | Published meter readings, playhead display, underruns, CPU load (accumulators stay engine state)     | Runtime/relay layer — never fed back into truth            |

Never invent a new category: fit the value or split it.

**Why:** two categories “fitting” means the design is mixed; split the value or the owner before coding.

**Enforced by:** review only.

### 2. One owner per authoritative write

Feature A never mutates feature B’s project slice. Cross-feature intent goes through a command or the owning module’s use case.

**Why:** multi-writer truth makes undo, CRDT, and collaboration undefined.

**Enforced by:** ESLint `sourdaw/no-foreign-store-write` (error) for store writes; otherwise review only.

### 3. Stores are a public read contract, not a write API for business truth

Foreign modules may `useStore` / select. A business store is written only by its owning module's write path (handler / use case), and a CRDT-backed store only while that write runs inside an action's transaction — the synchronous part of `executeAppAction`, or a `scope(...)` captured before the first `await` (`crdt-collaboration` rule 2). Everyone else dispatches through the owner's use cases or an action: a dispatch a person triggered enters through `executeUserAppAction`, while programmatic, agent, and handler dispatch use `executeAppAction` directly (canonical: `ui-patterns` rule 8). A business-store write from presentation, a write to a foreign module's store, or a CRDT-backed write outside any action transaction is the defect. Leaf components must not **directly** import business stores.

**Why:** write discipline is what prevents global mutability, and a write outside the owner's transaction is never seen by the document, undo, persistence, or collaboration.

**Enforced by:** ESLint `sourdaw/no-foreign-store-write` (**error**) for foreign-module writes; dependency-cruiser `components-no-business-store-access` (**error**); an owner's write outside a transaction is review only.

### 4. Project truth is serializable; engine/runtime state is not

Never put `AudioContext`, `AudioNode`, worklet handles, or other runtime objects in general stores or project state.

**Why:** save/load and collaboration cannot round-trip live native handles; the engine owns runtime objects.

**Enforced by:** review only.

### 5. Undo/history only for intentional project writes

Ephemeral UI and query-cache churn never create undo entries. Continuous gestures coalesce into one meaningful write.

**Why:** undo that rewinds hover state or network cache is unusable; missing undo on project edits is data loss.

**Enforced by:** review only.

### 6. Commands express intent; events report outcomes

Events never replace commands as the write API. Subscribers react; they do not become a second owner of truth. Event contracts stay pure.

**Why:** “notify by event” that mutates foreign state is a hidden write path.

**Enforced by:** dependency-cruiser `events-are-pure`; subscriber behavior is review only.

### 7. Projections and selectors are derived and disposable

Never persist a derivative as truth. Selectors stay read-only — no write side effects on read or render.

**Why:** stored derivatives drift from source truth and become a second model.

**Enforced by:** `src/modules/CrdtDocument/useCases/projection/__tests__/projectionIsReadOnly.spec.ts` for projections (document writes only in slots declaring `derivedFromSiblingSlot`); selectors are review only.

### 8. Async fetch/cache is not editable business state

Edit project truth through domain writes, then invalidate or refetch. The query cache is never a mutable document.

**Why:** cache-as-truth reimplements a worse store without ownership or undo.

**Enforced by:** review only.

### 9. Cross-module transient state follows a paired commit notification

When a committed command must update another module's transient state such as Project `dirty`, return paired `afterCommit` and `afterAmbiguousCommit` effects that publish a dedicated nonpersistent revision notification owned by the command's module. The receiving module subscribes through the public stores contract and owns its local write and subscription disposal. Do not import the receiver's business barrel, set transient state inside the transaction, or subscribe broadly to mixed project/runtime stores. The notification is shared runtime state, never persisted project truth or undo state.

**Why:** the command runtime is the commit witness; a store observer cannot distinguish a durable user edit from hydration, playback, or preview, and no-write, refusal, conflict, and isolated preview paths must stay clean.

**Enforced by:** review only.

### 10. A grouped inverse is captured from the owning action prefix

`executeAppActionBatch` describes every member before any member executes. When a handler's description captures an inverse from project state, project the earlier siblings through the owning domain before reading that state, and use the same projection for batch validation.

**Why:** capturing from the live pre-batch state restores the wrong value on grouped undo and redo.

**Enforced by:** review only (probe in `review-stances/replay-authority.md`).

## References

- [docs/03-state-management.md](../../../docs/03-state-management.md) — store patterns and client state.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — canonical state-category taxonomy (§6).
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — stores as contract surfaces.
- [docs/04-events.md](../../../docs/04-events.md) — event contracts vs commands.
- Review probes for this area: `../review-stances/command-entry-and-state-oracles.md` (command entry) and `../review-stances/replay-authority.md` (identity-scoped replay, grouped inverses) and `../review-stances/asset-cache-publication.md` (durable ownership, async cache admission, prepared settlement).
