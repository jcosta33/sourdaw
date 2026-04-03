# SKILL: state-and-write-paths

---

name: state-and-write-paths
description: Apply when creating, editing, or reviewing any form of state: project truth, shared runtime state, projections, selectors, stores, undo/redo, command execution, events, async fetching, UI state, or telemetry flows. This is the authoritative skill for state ownership and write-path discipline.

---

## Purpose

This skill exists to prevent state confusion, hidden mutation, and fake architecture.

Most architectural drift starts when code stops distinguishing between:

- truth
- projection
- runtime state
- telemetry
- UI state
- async fetch/cache state

This skill teaches agents to decide:

1. what kind of state something is
2. who owns it
3. who may write it
4. how it should be exposed
5. what write path should exist

The primary question is **not** “which store should I use?”
The primary question is **“what kind of state is this?”**

---

## State categories

Every state value must be classified first.

### 1. Project state

This is authoritative truth.

Examples:

- tracks
- clips
- routing definitions
- automation
- transport configuration
- tempo map
- markers
- plugin/device ordering
- saved parameter values
- preset references

Properties:

- serializable
- persistent
- undoable
- collaboration-relevant
- business-owned

### 2. Shared runtime state

This is app-wide runtime visibility that is not project truth.

Examples:

- engine ready status
- MIDI device list
- backend capability info
- plugin scan results
- native runtime availability

Properties:

- cross-feature visible
- not necessarily persistent
- not authoritative project truth

### 3. Persistent UI state

This is local preference state, not project truth.

Examples:

- zoom preference
- panel layout
- sidebar open
- workspace mode preference
- user inspector layout preference

### 4. Ephemeral UI state

This is temporary feature/view interaction state.

Examples:

- selection
- active tool
- drag state
- hover target
- scroll position
- temporary editor mode

### 5. Local component state

This is component-only state.

Examples:

- input draft
- temporary disclosure state
- local popover visibility
- one-component hover/focus flag

### 6. Engine/runtime state

This is runtime-owned and non-serializable.

Examples:

- `AudioContext`
- `AudioNode`
- plugin instance handles
- native windows
- DSP buffers
- live host/runtime objects
- engine handles

### 7. Telemetry

This is read-oriented feedback from runtime or long-running work.

Examples:

- meters
- displayed playhead position
- CPU/load stats
- underruns
- waveform extraction progress
- AI token stream progress
- render progress

Telemetry is not project truth unless explicitly committed through an application action.

### 8. Async fetch/cache state

This is request-oriented state.

Examples:

- remote metadata query results
- cached search results
- request loading/error state
- suspense/query cache state

This should not automatically be confused with project truth or general UI state.

---

## Write model

### Commands/actions are the preferred write boundary

All meaningful business writes should happen through explicit actions or commands.

A command/action should:

- express intent
- validate inputs
- enforce invariants
- update authoritative state
- coordinate undo/redo
- support coalescing for continuous gestures
- emit meaningful events when warranted
- call adapters when needed

### Stores are not the write model

A store may expose:

- truth
- projections
- runtime visibility
- UI state

A store must not quietly replace commands/actions as the mutation surface for meaningful business changes.

### Shared stores are allowed; shared mutability is not

Many parts of the app may read a shared store.

That does **not** mean many parts may write it directly.

A store may be globally visible without being globally writable.

---

## Ownership rules

### Every authoritative slice has one owner

Every slice of project truth has one owning business area.

Only its owning write boundary may mutate it directly.

Other code may:

- read it
- request changes through explicit actions
- react to meaningful events
- derive projections from it

Other code may **not** mutate it directly.

### Cross-feature writes must use public write boundaries

If feature A needs to change feature B’s truth:

- call B’s explicit action/command
- or route through a shared command registry
- or use a meaningful event if the architecture calls for that

Do not mutate another feature’s state slice directly.

---

## Projections and read models

### Projections are derived, read-oriented, and disposable

Use projections/read models/selectors for:

- flattened UI structures
- filtered/searchable structures
- timeline summaries
- mixer summaries
- derived clip maps
- parameter display state
- renderer-ready views

A projection:

- may be briefly stale
- must be derivable
- must not become the hidden source of truth

### Selectors must stay read-oriented

Selectors/projections may shape data.
They must not:

- emit events
- write truth
- perform side-effectful orchestration
- call runtime APIs to mutate state

---

## Events

### Events are for meaningful occurrences, not everything

Use events when:

- another concern must react independently
- the occurrence has business meaning
- the event matters for logging/history/integration/collaboration

Do not emit events for every trivial field change just to avoid explicit ownership.

### Events do not replace commands/actions

Commands/actions express intent.
Events report meaningful occurrences.
Stores expose state.
These are different roles.

---

## Undo/redo and coalescing

### Every meaningful write should be representable

Writes should be shaped so they are:

- explicit
- reversible where appropriate
- groupable for continuous interaction
- understandable in history

### Continuous interactions must coalesce

Examples:

- fader drags
- knob changes
- automation editing
- clip dragging
- scrubbing

These should form meaningful undo units, not floods of tiny unrelated history steps.

---

## Async state guidance

### Use query-oriented tools for request lifecycle

Use async-query/fetch patterns for:

- request caching
- suspense integration
- loading/error state
- invalidation

Do not stuff all request state into generic app stores.

### Query caches are not automatically business truth

If data becomes part of the DAW’s authoritative editable state, it must still be incorporated into the correct write/truth model.

---

## Placement heuristics

### Use project truth when it must be

- saved
- undone
- collaborated on
- validated as business state

### Use shared runtime state when it must be visible app-wide but is not project truth

### Use persistent UI state when it is preference-like

### Use ephemeral UI state when it is interaction-local

### Use runtime state only for live runtime resources

### Use telemetry for read-only feedback

### Use async query/cache state for request lifecycle management

---

## Anti-patterns

### 1. Unclassified state

Wrong:

- add new state without deciding whether it is truth, projection, runtime, telemetry, or UI state

Right:

- classify first, then place it

### 2. Projection becomes truth

Wrong:

- mutable derived state treated as authoritative

Right:

- truth is owned separately; projections remain derivable

### 3. Store as service

Wrong:

- store acts as read API, write API, event bus, and orchestration layer

Right:

- stores expose state; commands/actions own meaningful writes

### 4. Runtime object in store

Wrong:

- `AudioNode`, plugin instance, engine handle, native window in general shared stores or truth stores

Right:

- runtime owns runtime objects

### 5. Telemetry written back automatically

Wrong:

- meters or displayed playhead silently mutate truth

Right:

- telemetry stays read-oriented unless explicitly committed

### 6. Cross-feature write through direct store mutation

Wrong:

- feature A mutates feature B’s authoritative slice

Right:

- call the owning action/command

### 7. In-place mutation of snapshots

Wrong:

- mutate nested objects from store snapshots directly

Right:

- explicit owning write path

### 8. Query cache mistaken for domain state

Wrong:

- query result becomes implicit editable truth without explicit adoption into project state

Right:

- keep fetch/cache concerns distinct from authoritative editable truth

### 9. Events as ownership substitute

Wrong:

- emit events everywhere to avoid declaring owners and actions

Right:

- define ownership clearly first

---

## Review checklist

Before accepting state code, verify:

1. What category of state is this?
2. Who owns it?
3. Who is allowed to write it?
4. Is the write path explicit?
5. Is a store being used as a hidden write API?
6. Is any runtime object leaking into state containers?
7. Is telemetry being mistaken for truth?
8. Is a derivable value being stored unnecessarily?
9. Does the change preserve undo/coalescing semantics?
10. Are commands/actions, events, and stores playing distinct roles?

---
