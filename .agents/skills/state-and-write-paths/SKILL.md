---
name: state-and-write-paths
description: >-
  Classify every state value and route every write through its owning boundary
  before adding or changing state. ALWAYS apply when adding, editing, or reviewing
  project truth, stores, selectors/projections, undo/redo, commands, events, async
  fetch/cache state, UI state, or telemetry — even if it looks like "just one more
  store field". Do not write business state through a store, mutate another
  feature's slice, or treat query cache as editable truth. Skip pure presentational
  props with no persistence, and engine-internal RT buffers.
---

## Purpose

Unclassified state is how DAW truth corrupts: a store field that is half project / half UI, a foreign slice write that breaks undo, or a React handle sitting where serialized truth belongs. Classify first, then place the write.

## Core rules

### 1. Classify every value into exactly one category before placing it

| Category | What it is | Write path |
|----------|------------|------------|
| Project state | Authoritative truth (tracks, clips, routing, automation, tempo, markers, device order, saved params) | Owning domain use cases / commands; serializable, undoable |
| Shared runtime | App-wide runtime visibility (engine ready, device lists, scan results) | Owning subsystem; not project truth |
| Persistent UI | Local prefs (zoom, layout, sidebar) | Prefs storage — not the project file |
| Ephemeral UI | Selection, tool, drag, hover | Feature/view; disposable |
| Local component | Draft input, popover open | `useState` / form in that component |
| Engine/runtime | Live graph, playhead execution, meters | Engine only — non-serializable |
| Async fetch/cache | Server/query results | TanStack Query (or equivalent) — not business writes |
| Telemetry | Logs, metrics | Side channel — never truth |

**Why:** two categories “fitting” means the design is mixed; split the value or the owner before coding.

### 2. One owner per authoritative write

Feature A never mutates feature B’s project slice. Cross-feature intent goes through a command or the owning module’s use case.

**Why:** multi-writer truth makes undo, CRDT, and collaboration undefined.

### 3. Stores are a public read contract, not a write API for business truth

Foreign modules may `useStore` / select. `store.set` only inside the owning module’s write path (use cases / handlers). Outside: use cases or `executeAppAction` (**policy**; foreign-write ESLint is **warn** only). Leaf components must not **directly** import business stores (**error** `components-no-business-store-access`).

**Why:** Sourdaw keeps stores as read contracts; write discipline is what prevents global mutability.

### 4. Project truth is serializable; engine/runtime state is not

Never put `AudioContext`, `AudioNode`, worklet handles, or other runtime objects in general stores or project state.

**Why:** save/load and collaboration cannot round-trip live native handles; the engine owns runtime objects.

### 5. Undo/history only for intentional project writes

Ephemeral UI and query-cache churn must not invent undo entries. Continuous gestures coalesce into meaningful writes.

**Why:** undo that rewinds hover state or network cache is unusable; missing undo on project edits is data loss.

### 6. Commands express intent; events report outcomes

Events do not replace commands as the write API. Subscribers react; they do not become a second owner of truth. Event contracts stay pure (`events-are-pure`).

**Why:** “notify by event” that mutates foreign state is a hidden write path.

### 7. Projections and selectors are derived and disposable

Never persist derived-as-truth. Selectors stay read-only — no write side effects on read/render.

**Why:** stored derivatives drift from source truth and become a second model.

### 8. Async fetch/cache is not editable business state

Edit project truth through domain writes; invalidate or refetch the cache. Do not treat the query cache as a mutable document.

**Why:** cache-as-truth reimplements a worse store without ownership or undo.

## What does not belong

- Pure presentational props that never persist or cross features.
- Engine-internal RT buffers and schedules.
- Inventing a ninth category instead of fitting or splitting the design.
- “Just one more field” on a store without classification.

## Anti-patterns

### CRITICAL — Store as write API for business truth

❌ Wrong: any module calls `trackStore.set(…)` to “add a track”.

✅ Correct: Arrangement (or Command) use case owns the write; others call that API.

### CRITICAL — Runtime object in a general store

❌ Wrong: `audioContextStore` holding the live `AudioContext`.

✅ Correct: engine-owned runtime; expose summaries/APIs only.

### CRITICAL — Feature A mutates feature B’s slice

❌ Wrong: Mixer code directly rewrites Arrangement clip state.

✅ Correct: command / Arrangement use case.

### HIGH — Unclassified new field

❌ Wrong: add `foo` to a store “for now”.

✅ Correct: pick a row from the category table, then place the write.

### HIGH — Derived value stored as truth

❌ Wrong: persist `visibleClips` that is just a filter of clips.

✅ Correct: selector/projection over source truth.

### HIGH — Query cache treated as editable truth

❌ Wrong: mutate TanStack Query data as if it were the project document.

✅ Correct: domain write + invalidate/refetch.

### MEDIUM — Events instead of ownership

❌ Wrong: emit an event whose only listener is a known foreign mutator standing in for a use-case call.

✅ Correct: call the owning use case (or command) directly for intentional writes.

## References

- [docs/03-state-management.md](../../../docs/03-state-management.md) — store patterns and client state.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — stores as contract surfaces.
- [docs/04-events.md](../../../docs/04-events.md) — event contracts vs commands.
