---
name: state-and-write-paths
type: agent-guide
description: >-
  Classify every state value and route every write through its owning boundary before adding or
  changing state. ALWAYS apply this skill when adding, editing, or reviewing project truth, stores,
  selectors/projections, undo/redo, commands, events, async fetch/cache state, UI state, or
  telemetry — even if it looks like "just one more store field". Do not write business state through
  a store, mutate another feature's slice directly, or stash a runtime object in a state container.
  Skip this skill for pure rendering/styling work, build/config changes, and dependency bumps that
  touch no state.
---

# Skill: state-and-write-paths

## Purpose

This skill prevents state confusion, hidden mutation, and fake architecture. Most architectural
drift starts when code stops distinguishing truth from projection from runtime state from telemetry
from UI state from async fetch/cache state — and a store quietly becomes the mutation surface for
business changes that should flow through commands. The primary question is **not** "which store
should I use?" — it is **"what kind of state is this, and who is allowed to write it?"**

For every state value, decide in order: (1) what kind of state it is, (2) who owns it, (3) who may
write it, (4) how it should be exposed, (5) what write path should exist.

---

## Core rules

### 1. Classify before you place

Every state value must be classified into exactly one of the eight categories (see
`references/state-categories.md`) before it is added or moved: project state, shared runtime state,
persistent UI state, ephemeral UI state, local component state, engine/runtime state, telemetry, or
async fetch/cache state. _Why: unclassified state lands in whatever store is nearest and inherits
the wrong persistence, undo, and ownership semantics — the root cause of most drift._

### 2. Commands/actions are the write boundary for business changes

All meaningful business writes flow through explicit actions or commands. A command/action should:
express intent, validate inputs, enforce invariants, update authoritative state, coordinate
undo/redo, support coalescing for continuous gestures, emit meaningful events when warranted, and
call adapters when needed. _Why: the write boundary is where invariants and undo live; bypassing it
spreads validation and history logic into callers where it rots._

### 3. Stores expose state; they are not the write model

A store may expose truth, projections, runtime visibility, or UI state. A store must **not** quietly
replace commands/actions as the mutation surface for meaningful business changes. _Why: a store that
is read API + write API + event bus + orchestration is a service in disguise, and every consumer
becomes a writer with no invariant enforcement._

### 4. Shared stores are allowed; shared mutability is not

Many parts of the app may read a shared store. That does **not** mean many parts may write it
directly. A store may be globally visible without being globally writable. _Why: global write access
is unbounded blast radius — any reader can corrupt state with no owning code to hold the line._

### 5. Every authoritative slice has exactly one owner

Every slice of project truth has one owning business area, and only its owning write boundary may
mutate it directly. Other code may read it, request changes through explicit actions, react to
meaningful events, or derive projections from it — but may **not** mutate it directly. _Why: single
ownership is what makes a write path auditable; many writers means no one can reason about what
state can become._

### 6. Cross-feature writes use public write boundaries

If feature A needs to change feature B's truth: call B's explicit action/command, or route through a
shared command registry, or use a meaningful event if the architecture calls for that. Do not mutate
another feature's state slice directly. _Why: direct cross-feature mutation couples features through
their internals, so B can never change its slice shape without silently breaking A._

### 7. Map the blast radius before changing a slice's shape or write path

When you modify the structure of a state slice or its write path, map its blast radius: who reads
this, who writes this, which upstream commands mutate it, and which downstream selectors/components
project it. Lean on the TypeScript compiler (`cmdTypecheck`) to verify that all consumers are
updated to the new shape — do not assume the local change is safe until the compiler proves it.
_Why: state shape is a contract with every selector and component that touches it; the compiler is
the only honest census of consumers._

### 8. Projections are derived, read-oriented, and disposable

Use projections/read models/selectors for flattened UI structures, filtered/searchable structures,
timeline summaries, mixer summaries, derived clip maps, parameter display state, and renderer-ready
views. A projection may be briefly stale, must be derivable, and must **not** become the hidden
source of truth. _Why: once a derived value is treated as authoritative, the real truth and the
projection drift apart and there is no longer a single answer to "what is true"._

### 9. Selectors stay read-oriented

Selectors/projections may shape data. They must **not** emit events, write truth, perform
side-effectful orchestration, or call runtime APIs to mutate state. _Why: a selector that mutates
runs on every read/render, turning a read path into an uncontrolled, repeated write._

### 10. Events report meaningful occurrences; they do not replace commands

Use events when another concern must react independently, when the occurrence has business meaning,
or when it matters for logging/history/integration/collaboration. Do not emit events for every
trivial field change just to avoid declaring ownership. Commands/actions express intent, events
report meaningful occurrences, stores expose state — three distinct roles. _Why: events-as-ownership
is implicit coupling; nobody owns the write, and the system's behavior becomes an untraceable web of
reactions._

### 11. Every meaningful write is representable; continuous interactions coalesce

Shape writes so they are explicit, reversible where appropriate, groupable for continuous
interaction, and understandable in history. Continuous interactions — fader drags, knob changes,
automation editing, clip dragging, scrubbing — must coalesce into meaningful undo units, not floods
of tiny unrelated history steps. _Why: per-event history steps make undo useless and bury intent;
coalescing is what keeps history legible and reversible at the gesture level._

### 12. Async fetch/cache state is request-oriented, not business truth

Use query-oriented tools for request caching, suspense integration, loading/error state, and
invalidation; do not stuff all request state into generic app stores. If fetched data becomes part
of the DAW's authoritative editable state, it must still be incorporated through the correct
write/truth model. _Why: query caches are evictable and request-shaped; treating a cache entry as
editable truth means the next invalidation silently discards user edits._

---

## Placement heuristics

Resolve the category from rule 1, then place by intent:

- **Project truth** — when it must be saved, undone, collaborated on, or validated as business state.
- **Shared runtime state** — when it must be visible app-wide but is not project truth.
- **Persistent UI state** — when it is preference-like.
- **Ephemeral UI state** — when it is interaction-local.
- **Runtime state** — only for live runtime resources.
- **Telemetry** — for read-only feedback.
- **Async query/cache state** — for request lifecycle management.

Telemetry is not project truth unless explicitly committed through an application action.

---

## What does not belong

- **Runtime objects in state containers.** `AudioContext`, `AudioNode`, plugin instance handles,
  native windows, DSP buffers, live host/runtime objects, and engine handles belong to the runtime
  that owns them — never in general shared stores or truth stores.
- **Derivable values stored as state.** If a value can be computed from truth, it is a projection,
  not a stored field.
- **Request state in general app stores.** Loading/error/cache lifecycle lives in query-oriented
  tooling, not a generic store.
- **Side effects in selectors.** Orchestration, event emission, and mutation are write-path
  concerns; selectors are read-path only.
- Native plugin host/runtime resource lifecycle and RT-safe host communication are owned elsewhere
  (see `../plugin-hosting/SKILL.md` and `../web-audio-engine/SKILL.md`, if installed); this skill
  governs how that runtime state is *classified and exposed*, not how the runtime itself is built.

---

## Anti-patterns

| # | Temptation (wrong) | Do instead (right) |
|---|---|---|
| 1 | Add new state without deciding whether it is truth, projection, runtime, telemetry, or UI state | Classify first (rule 1), then place it |
| 2 | Treat mutable derived state as authoritative | Own truth separately; keep projections derivable |
| 3 | Let a store act as read API, write API, event bus, and orchestration layer | Stores expose state; commands/actions own meaningful writes |
| 4 | Put an `AudioNode`, plugin instance, engine handle, or native window in a general shared store or truth store | Let the runtime own runtime objects |
| 5 | Let meters or displayed playhead silently mutate truth | Keep telemetry read-oriented unless explicitly committed |
| 6 | Have feature A mutate feature B's authoritative slice directly | Call the owning action/command |
| 7 | Mutate nested objects from store snapshots in place | Use the explicit owning write path |
| 8 | Let a query result become implicit editable truth without explicit adoption | Keep fetch/cache concerns distinct from authoritative editable truth |
| 9 | Emit events everywhere to avoid declaring owners and actions | Define ownership clearly first, then emit events for meaningful occurrences |

---

## Self-review gate

Before accepting state code, walk every item below and write the answer down. Not complete until
each of the ten questions has an explicit written answer in the review notes, the blast-radius
consumer list (rule 7) is enumerated, and the `cmdTypecheck` output appears verbatim showing all
consumers compile against the new state shape.

1. What category of state is this? (one of the eight in `references/state-categories.md`)
2. Who owns it?
3. Who is allowed to write it?
4. Is the write path explicit (a command/action, not a raw store write)?
5. Is a store being used as a hidden write API?
6. Is any runtime object leaking into state containers?
7. Is telemetry being mistaken for truth?
8. Is a derivable value being stored unnecessarily?
9. Does the change preserve undo/coalescing semantics?
10. Are commands/actions, events, and stores playing distinct roles?

If any slice shape or write path changed, the `cmdTypecheck` run is mandatory — a green compile is
the proof that every projecting selector and component was updated. Paste the last lines of that
output verbatim. A claim that "consumers are fine" without pasted `cmdTypecheck` output reads as
unverified, not pass.

---

## Bundled resources

- `references/state-categories.md` — the eight state categories in full: definition, concrete
  examples, and defining properties for each (project state, shared runtime state, persistent UI
  state, ephemeral UI state, local component state, engine/runtime state, telemetry, async
  fetch/cache state).
