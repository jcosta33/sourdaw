---
name: state-and-write-paths
description: >-
    Classify every state value and route every write through its owning boundary
    before adding or changing state. ALWAYS apply when adding, editing, or reviewing
    project truth, stores, selectors/projections, undo/redo, commands, events, async
    fetch/cache state, UI state, or telemetry — even if it looks like "just one more
    store field". Skip pure presentational props with no persistence, and
    engine-internal RT buffers.
---

## Purpose

Unclassified state is how DAW truth corrupts: a store field that is half project / half UI, a foreign slice write that breaks undo, a React handle sitting where serialized truth belongs. Classify first, then place the write.

## Core rules

### 1. Classify every value into exactly one category before placing it

| Category          | What it is                                                                                           | Write path                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Project state     | Authoritative truth (tracks, clips, routing, automation, tempo, markers, device order, saved params) | Owning domain use cases / commands; serializable, undoable |
| Shared runtime    | App-wide runtime visibility (engine ready, device lists, scan results)                               | Owning subsystem; not project truth                        |
| Persistent UI     | Local prefs (zoom, layout, sidebar)                                                                  | Prefs storage — not the project file                       |
| Ephemeral UI      | Selection, tool, drag, hover                                                                         | Feature/view; disposable                                   |
| Local component   | Draft input, popover open                                                                            | `useState` / form in that component                        |
| Engine/runtime    | Live graph, playhead execution, meters                                                               | Engine only — non-serializable                             |
| Async fetch/cache | Server/query results                                                                                 | TanStack Query or equivalent — not business writes         |
| Telemetry         | Logs, metrics                                                                                        | Side channel — never truth                                 |

Never invent a new category: fit the value or split it.

**Why:** two categories “fitting” means the design is mixed; split the value or the owner before coding.

### 2. One owner per authoritative write

Feature A never mutates feature B’s project slice. Cross-feature intent goes through a command or the owning module’s use case.

**Why:** multi-writer truth makes undo, CRDT, and collaboration undefined.

### 3. Stores are a public read contract, not a write API for business truth

Foreign modules may `useStore` / select. `store.set` only inside the owning module’s write path (use cases / handlers); everyone else goes through use cases or `executeAppAction` (**policy** — the foreign-write ESLint rule is **warn** only). Leaf components must not **directly** import business stores (**error** `components-no-business-store-access`).

**Why:** write discipline is what prevents global mutability.

### 4. Project truth is serializable; engine/runtime state is not

Never put `AudioContext`, `AudioNode`, worklet handles, or other runtime objects in general stores or project state.

**Why:** save/load and collaboration cannot round-trip live native handles; the engine owns runtime objects.

### 5. Undo/history only for intentional project writes

Ephemeral UI and query-cache churn never create undo entries. Continuous gestures coalesce into one meaningful write.

**Why:** undo that rewinds hover state or network cache is unusable; missing undo on project edits is data loss.

### 6. Commands express intent; events report outcomes

Events never replace commands as the write API. Subscribers react; they do not become a second owner of truth. Event contracts stay pure (`events-are-pure`).

**Why:** “notify by event” that mutates foreign state is a hidden write path.

### 7. Projections and selectors are derived and disposable

Never persist a derivative as truth. Selectors stay read-only — no write side effects on read or render.

**Why:** stored derivatives drift from source truth and become a second model.

### 8. Async fetch/cache is not editable business state

Edit project truth through domain writes, then invalidate or refetch. The query cache is never a mutable document.

**Why:** cache-as-truth reimplements a worse store without ownership or undo.

## References

- [docs/03-state-management.md](../../../docs/03-state-management.md) — store patterns and client state.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — canonical state-category taxonomy (§6).
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — stores as contract surfaces.
- [docs/04-events.md](../../../docs/04-events.md) — event contracts vs commands.
