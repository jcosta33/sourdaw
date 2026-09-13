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

When a committed command must update another module's transient state such as Project `dirty`, return paired `afterCommit` and `afterAmbiguousCommit` effects that publish a dedicated nonpersistent revision notification owned by the command's module. The receiving module subscribes through the public stores contract and owns its local write and subscription disposal. Do not import the receiver's business barrel, set transient state inside the transaction, or subscribe broadly to mixed project/runtime stores: no-write, refusal, conflict, and isolated preview paths must remain clean. The notification is shared runtime state, never persisted project truth or undo state.

**Why:** the command runtime is the commit witness; a store observer cannot distinguish a durable user edit from hydration, playback, or preview.

### 6. Commands express intent; events report outcomes

Events never replace commands as the write API. Subscribers react; they do not become a second owner of truth. Event contracts stay pure (`events-are-pure`).

**Why:** “notify by event” that mutates foreign state is a hidden write path.

### 7. Projections and selectors are derived and disposable

Never persist a derivative as truth. Selectors stay read-only — no write side effects on read or render.

**Why:** stored derivatives drift from source truth and become a second model.

### Command entry must prove normalized state reaches every authority

For a normalized project-state command, test the authoritative terminal projection through the public command entry: raw document, owning store projection, visible control state, and engine projection must agree on the same committed value. #4082 (commit `418906`, merged as `dcb995a`) showed that a Loop control could update a visible flag while leaving an invalid loop region that the document decoder rejected. A direct use-case or static-prop fixture cannot prove this agreement.

### 8. Async fetch/cache is not editable business state

Edit project truth through domain writes, then invalidate or refetch. The query cache is never a mutable document.

**Why:** cache-as-truth reimplements a worse store without ownership or undo.

## Anti-patterns

### Durable ownership must authenticate the exact current source

PR #3943 acquired checkpoint retention from raw audio buffer IDs, so a replaced runtime source could publish ownership
over stale disk PCM. Review every acquisition route with a genuine durability receipt and active storage scope, then
change the source after retention commits and prove exact-token cleanup either removes the row or reports retained
ownership explicitly.

### Async cache admission must stay release-visible before every await

Review the path from request admission through every await before cache registration. Release or cancel while transfer
data is pending, then admit a fresh request and prove late cleanup affects only its exact former entry. Tests must
observe release-visible ownership before provider creation begins.

## Prepared settlement review crosses module instances

Use a strongest-tier integrity review with two module instances sharing IndexedDB and the named storage lock. Test
known durable, hydrated, and evicted PCM, and attack fresh durability checks separately from acquisition through an
older receipt. Reuse one buffer ID and lease with different PCM and persistence revisions, then exercise promotion and
discard over temporary and already-settled durable owners. Local object identity, runtime tokens, lease equality, and
scope locks do not establish persistent PCM identity; the source map introduced by #3877 and receipt authentication
added by #4051 each require this cross-instance proof. Compose eviction with an explicit retained project reset and
hydration in one attack: isolated eviction and hydration cases do not prove that the retained transition preserves an
identity witness when no decoded runtime remains.

Treat any pre-commit cache invalidation as an identity transition, not cleanup. A cold module can authenticate an exact
prepared row from its durable revision, stage deletion and then observe an aborted transaction; the unchanged row must
remain readable and recoverable in that same module. Carry explicit preserved, read-origin and admitted-commit
witnesses through invalidation, and attack each with a later source replacement before accepting retry or recovery.
Capture a prepared release's publication authority at mutation admission, before it waits for the storage lock; recapturing
inside the queued storage phase can authenticate an intervening ordinary replacement as the older prepared commit.

## References

- [docs/03-state-management.md](../../../docs/03-state-management.md) — store patterns and client state.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — canonical state-category taxonomy (§6).
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — stores as contract surfaces.
- [docs/04-events.md](../../../docs/04-events.md) — event contracts vs commands.
