# DAW System Architecture

This document defines the **system-level architecture** of the DAW.

It describes:

- the non-negotiable architectural invariants
- the runtime boundaries
- the write/read model
- the state model
- how the frontend, engine, backend, and plugin host fit together
- how to reason about ownership and mutation

It does **not** define a fixed module catalog.
It does **not** define exact folder layouts for every module.
That belongs in the TypeScript and Rust architecture documents.

This document is the top-level source of truth for system architecture.

Related agent skills: `state-and-write-paths` (state categories), `crdt-collaboration` (CRDT write path), `web-audio-engine` (channels/engine), `desktop-platform` (placement).

---

## 1. Purpose

The architecture exists to solve these constraints at once:

1. The DAW must support real-time audio safely.
2. Business logic must remain framework-free and runtime-agnostic.
3. The codebase must remain operable despite legacy shortcuts and uneven quality.
4. AI agents must have enough structure to make good decisions without being over-constrained.
5. The system must support multiple runtime implementations, including browser-only and desktop/Rust-backed execution.
6. The architecture must support gradual convergence rather than requiring all-at-once rewrites.

This is not a greenfield purity document.
It is a system design for evolving a large DAW safely.

---

## 2. The system in one picture

```text
┌──────────────────────── PRESENTATION ────────────────────────┐
│ React views, hooks, contexts, renderer orchestration, refs   │
│ - renders UI                                                  │
│ - captures user intent                                        │
│ - subscribes to projections and telemetry                     │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │ commands / actions            │ reads
                │                               │
┌───────────────▼───────────────────────────────▼──────────────┐
│                  APPLICATION / WRITE MODEL                    │
│ actions, use cases, command handling, undo/redo, coalescing  │
│ - validates intent                                            │
│ - mutates project truth                                       │
│ - emits meaningful events                                     │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │ owns authoritative writes     │ derives
                │                               │
┌───────────────▼───────────────────────────────▼──────────────┐
│                         DOMAIN / TRUTH                        │
│ project model, business rules, invariants, value types       │
│ - serializable                                                │
│ - undoable                                                    │
│ - collaboration-ready                                         │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │ projections                    │ ports
                │                               │
┌───────────────▼──────────────┐   ┌────────────▼──────────────┐
│         READ MODEL            │   │   RUNTIME / INFRASTRUCTURE│
│ selectors, projections,       │   │ audio engine adapter      │
│ UI snapshots, telemetry views │   │ plugin host adapter       │
│ renderer-ready structures     │   │ persistence / IPC / I/O   │
└───────────────┬──────────────┘   └────────────┬──────────────┘
                │                               │
                │ telemetry / display           │ commands / diffs
                │                               │
         ┌──────▼───────────────────────────────▼──────┐
         │              REAL-TIME ENGINE                │
         │ AudioContext / DSP / plugin processing /     │
         │ scheduling / metering / transport execution  │
         └──────────────────────────────────────────────┘
```

---

## 3. Architectural invariants

These rules are non-negotiable.

### 3.1 The real-time boundary is absolute

Nothing on the real-time audio path may:

- allocate unpredictably
- block
- acquire locks
- touch React state
- perform file I/O
- perform network I/O
- depend on slow IPC
- depend on browser rendering lifecycles

All state read by the audio callback or equivalent RT path must be prepared ahead of time and handed off through RT-safe mechanisms.

### 3.2 The project model is the source of truth

All persistent, serializable, undoable state lives in the project model.

The engine is not the source of truth.
The plugin host is not the source of truth.
The UI is not the source of truth.

They are all:

- projections
- views
- adapters
- executors
- feedback channels

derived from project truth and command flow.

### 3.3 Business logic is React-free

Business logic must not depend on:

- React
- hooks
- JSX
- component lifecycle
- browser widget semantics

React is presentation only.

### 3.4 The desktop shell is a bridge, not the core

The Electron shell and the native addon behind it are an integration seam.

It is not:

- the domain model
- the business layer
- the audio engine
- the source of truth

Anything that matters outside the shell must live outside shell-specific code.

### 3.5 Writes and reads are different concerns

Writes happen through explicit actions and commands.

Reads happen through:

- selectors
- projections
- read models
- telemetry
- query snapshots

State synchronization does not replace business meaning.

### 3.6 Architecture is defined by boundaries, not folders

Folder structure is an implementation detail.

Architectural compliance is determined by:

- dependency direction
- ownership
- mutation authority
- runtime constraints
- boundary clarity

A rough folder tree with clean boundaries is better than a beautiful folder tree with leaking abstractions.

### 3.7 Prefer convergence over rewrites

The codebase already exists and contains shortcuts.

The rule for legacy code is:

- do not preserve debt out of convenience
- do not rewrite stable code merely for aesthetics
- improve the nearest boundary when touching code
- move toward the target architecture incrementally

---

## 4. The five most important truths

### 4.1 Project truth is authoritative

If a value is:

- saved with the project
- undoable
- collaboration-relevant
- part of the business state

then it belongs in project truth.

### 4.2 The engine executes; it does not define meaning

The engine owns:

- runtime graph objects
- transport execution
- DSP state
- plugin processing state
- metering internals

It does not define what a track, clip, or bus _means_.

### 4.3 Projections are disposable

A projection may be stale briefly.
A projection may be recomputed.
A projection must not become hidden truth.

### 4.4 Shared visibility is not shared ownership

Many parts of the app may read the same state.
That does not mean they all own writes to that state.

### 4.5 Real-time safety outranks local convenience

If a design is locally convenient but weakens the RT boundary, it is the wrong design.

---

## 5. System topology

The system has six conceptual layers.

### 5.1 Presentation layer

Responsibilities:

- render UI
- manage local interaction
- bind user intent to application actions
- subscribe to projections and stores
- display telemetry
- run layout/render orchestration
- host canvas/WebGL/WebGPU surfaces

Presentation may use:

- React
- refs
- requestAnimationFrame
- contexts
- external stores
- view-local state

Presentation does **not** define business rules.

### 5.2 Application layer

Responsibilities:

- define actions/use cases/commands
- validate input at the write boundary
- call domain logic
- invoke ports/adapters
- commit project mutations
- emit meaningful events
- coordinate undo/redo
- coalesce continuous edits

This is the preferred write boundary.

### 5.3 Domain layer

Responsibilities:

- define business types
- define invariants
- define pure business rules
- define calculations and policies
- define business-significant errors and events

This layer is plain code:

- no React
- no desktop IPC
- no browser APIs
- no raw runtime handles

### 5.4 Projection layer

Responsibilities:

- derive engine instructions from project truth
- derive UI-friendly structures
- expose selector-driven stores
- maintain caches/indexes
- expose telemetry snapshots
- provide renderer-ready views

A projection must not become an alternate write model.

### 5.5 Runtime/infrastructure layer

Responsibilities:

- audio engine integration
- plugin host integration
- MIDI integration
- file I/O
- IndexedDB/local storage
- desktop commands/events/streams
- browser/native API bridges
- persistence and codec integration

This layer implements ports required by the application layer.

### 5.6 Real-time engine layer

Responsibilities:

- process audio
- execute compiled schedules or equivalent plans
- apply RT-safe parameter changes
- host runtime DSP state
- report telemetry

This layer must remain isolated from:

- UI logic
- business mutation
- blocking work
- slow shell/bridge calls

---

## 6. State model

Every state value must belong to one category.

## 6.1 State categories

| State category          | Source of truth             | Who may write                          | Persistence | Examples                                                          | Anti-pattern                             |
| ----------------------- | --------------------------- | -------------------------------------- | ----------- | ----------------------------------------------------------------- | ---------------------------------------- |
| Project state           | Project model               | Application actions of owning module   | Yes         | tracks, clips, routing, automation, plugin values, tempo, markers | storing runtime handles here             |
| Shared runtime state    | Runtime/projection layer    | Runtime adapters or owning app actions | Sometimes   | engine ready, MIDI devices, plugin scan results                   | treating it as project truth             |
| Persistent UI state     | UI preference layer         | Presentation logic                     | Local only  | zoom preference, panel layout                                     | saving this into project automatically   |
| Ephemeral UI state      | Presentation layer          | Presentation logic                     | No          | selection, active tool, drag state                                | sharing globally without need            |
| Local component state   | Component                   | Component                              | No          | input draft, local open state                                     | globalizing it                           |
| Engine/runtime state    | Engine/runtime              | Engine/runtime only                    | No          | AudioContext, AudioNodes, plugin instances                        | storing in React or project stores       |
| Telemetry state         | Runtime feedback            | Runtime/relay layer                    | No          | meters, playhead display, underruns, CPU                          | feeding it back into truth automatically |
| Async query/cache state | Query layer / request cache | Query tools or application edge        | Sometimes   | remote metadata cache, search results                             | treating it as domain truth              |

## 6.2 State decision matrix

```text
Is it saved with the project?
  yes -> Project state

No:
  Is it a live runtime object?
    yes -> Engine/runtime state

  Is it read-only feedback from runtime?
    yes -> Telemetry

  Is it a user preference that should survive refresh?
    yes -> Persistent UI state

  Is it shared runtime visibility but not project truth?
    yes -> Shared runtime state

  Is it view interaction state?
    yes -> Ephemeral UI state

  Is it only for one component?
    yes -> Local component state

  Is it request/cache lifecycle state?
    yes -> Async query/cache state
```

## 6.3 State rules

- Project state must be serializable.
- Engine/runtime state must never live in React state or project stores.
- Telemetry is not project state.
- UI preference state is not project state unless explicitly part of product semantics.
- If a value is undoable, it almost certainly belongs in project state.
- If a value depends on live runtime resources, it does not belong in project state.

---

## 7. Ownership and mutation

### 7.1 Every authoritative slice has one owner

Every slice of project truth has one owning business area.

Only its public application actions may mutate that slice directly.

Other code may:

- read it
- request changes through public actions
- react to meaningful events
- derive projections from it

Other code may **not** mutate it directly.

### 7.2 Cross-boundary changes must use explicit write paths

If one module needs another module’s state changed, it must:

- call that module’s public action
- or submit a command handled by that owner
- or emit a meaningful event another handler reacts to

It must not reach into another module’s internals and mutate them.

### 7.3 Projections are read-oriented

Projection stores may exist, but they must not become unofficial write backdoors.

### 7.4 Runtime state is runtime-owned

React state, contexts, and project stores must not own:

- AudioNodes
- plugin handles
- engine instances
- native window handles
- long-lived backend/runtime handles

### 7.5 Persistence derives from project truth

Save/load must operate on authoritative project state, not on arbitrary UI or runtime snapshots.

---

## 8. Write model

### 8.1 The system uses explicit write actions

Business changes enter through explicit application actions.

An action should:

- express intent
- validate input
- enforce rules
- update authoritative state
- emit meaningful events where appropriate
- support undo/redo
- be representable for collaboration later

### 8.2 Commands are the preferred write envelope

Internally, the architecture prefers a command-oriented write model.

This does not require full event sourcing.
It does require mutations to be:

- intentional
- representable
- undoable
- coalescible
- replayable where useful

Commands are the canonical record of user intent.

### 8.3 Continuous edits must coalesce

High-frequency interactions such as:

- fader drags
- knob twists
- automation edits
- clip drags
- scrubbing

must be grouped into meaningful undo units.

### 8.4 Events are for significance, not everything

Use an event when:

- another concern must react independently
- the occurrence matters for history/undo/collaboration/integration
- the event has business meaning

Do not create events just because a value changed.

---

## 9. Read model

### 9.1 Reads are projection-driven

The system exposes reads through:

- selectors
- projections
- caches
- query models
- telemetry channels

not arbitrary mutable objects.

### 9.2 Projection types

| Projection type      | Purpose                                          | Examples                                            |
| -------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Engine projection    | turn project truth into runtime instructions     | graph descriptions, parameter snapshots             |
| UI projection        | turn project truth into view-friendly structures | flattened lane lists, clip summaries                |
| Derived read model   | optimize complex queries                         | search indexes, browser groupings, precomputed maps |
| Telemetry projection | turn runtime feedback into display data          | meter snapshots, CPU display, waveform progress     |

### 9.3 Projection rules

- A projection may be stale briefly.
- A projection must be derivable.
- A projection must be disposable.
- A projection must not become hidden truth.

### 9.4 Read/write split in one picture

```text
WRITE SIDE
UI intent
  -> action/command
  -> domain validation
  -> project mutation
  -> event emission (if meaningful)

READ SIDE
project truth
  -> UI projections
  -> engine projections
  -> telemetry snapshots
  -> renderer-ready views
```

---

## 10. Runtime channels across the engine boundary

The anti-corruption boundary between business/application code and engine/runtime code is defined in terms of channels.

| Channel                           | Purpose                                    | Frequency     | Examples                                 |
| --------------------------------- | ------------------------------------------ | ------------- | ---------------------------------------- |
| Command channel                   | instruct runtime to do work                | low to medium | play, stop, seek, render                 |
| Parameter channel                 | deliver high-frequency controllable values | high          | gain, pan, automation, bypass            |
| Topology/update channel           | apply structural runtime changes           | low           | add plugin, remove track, routing change |
| Telemetry channel                 | deliver runtime feedback outward           | high          | meters, playhead, CPU, underruns         |
| Persistence/import/export channel | move data in and out                       | low to medium | save, load, decode, export               |

### 10.1 Channel rules

- Parameter updates must not force full graph rebuilds.
- Structural changes must flow through reconciliation.
- Telemetry must not directly mutate project truth.
- Persistence operations must stay outside the RT path.

---

## 11. Engine architecture

### 11.1 The engine is a runtime executor

The engine executes prepared state and runtime instructions.
It does not define the business meaning of tracks, clips, or project semantics.

### 11.2 The engine owns execution resources

The engine owns:

- audio context or backend stream handles
- runtime graph/node instances
- DSP object lifecycle
- real-time-safe buffers
- transport execution state
- meter generation

### 11.3 The engine consumes projections

Business/application code prepares the state the engine needs in runtime-friendly form.

### 11.4 The engine must support reconciliation

The architecture must distinguish:

- fast parameter updates
- structural changes
- transport changes
- bulk state swaps

### 11.5 Engine telemetry flows outward only

Telemetry should not directly mutate project truth.

If it needs to affect project truth, it must do so through an explicit application action.

---

## 12. Plugin host architecture

### 12.1 Plugin hosting is a subsystem

Plugin hosting is important enough to deserve explicit architectural treatment.

### 12.2 Project plugin state and runtime plugin state are different

| Project-side plugin state  | Runtime-side plugin state |
| -------------------------- | ------------------------- |
| plugin identity            | live plugin instance      |
| ordering                   | native handle             |
| parameter values           | editor window             |
| preset references          | audio processing buffers  |
| automation links           | host bridge state         |
| bypass/configured metadata | crash isolation state     |

These are not the same thing.

### 12.3 Plugin responsibilities must be separated

The architecture should distinguish:

- discovery
- metadata caching
- capability reporting
- instantiation
- parameter inspection
- editor presentation
- runtime processing

### 12.4 Native hosting stays behind ports/adapters

If the system supports VST® 3/CLAP through the desktop shell's native backend, that belongs behind ports and adapters.

### 12.5 Built-in devices and hosted plugins should align conceptually

Where practical, the project model should expose a shared conceptual surface:

- instance identity
- parameter model
- preset references
- automation targets
- routing participation

This does not require identical runtime implementations.

---

## 13. Persistence architecture

### 13.1 Persistence is based on project truth

Save/load operates on durable project structures, not transient view or runtime state.

### 13.2 Caches are not truth

Waveform caches, plugin scan caches, thumbnails, previews, and similar artifacts must be regenerable and treated separately from project truth.

### 13.3 Import/export are workflows

Importing and exporting often combine:

- file I/O
- decoding/encoding
- project mutations
- progress reporting
- failure handling

These should be explicit workflows, not helper calls buried in views.

---

## 14. Collaboration and replication readiness

The architecture should stay compatible with collaboration even if collaboration is partial.

### 14.1 Commands should be meaningful enough to replicate

Commands and events should express user intent at a level that can later be synchronized or transformed.

### 14.2 Coalescing must preserve meaning

A coalesced local undo unit should still be representable in a collaboration-friendly way.

### 14.3 Projections remain local

Collaboration should synchronize authoritative changes, not ephemeral projection caches.

### 14.4 Telemetry is not collaboration state by default

Meters and local playback display should not automatically become replicated state.

---

## 15. Error handling

### 15.1 Errors should be meaningful where they surface

Expose structured application-meaningful errors at public boundaries.

### 15.2 Runtime failures must not silently corrupt truth

The system must make clear whether:

- the project mutation committed
- the runtime update committed
- recovery is possible

### 15.3 Shell/framework errors are translated

Shell or browser-specific errors should be wrapped into stable application-facing structures.

---

## 16. Testing strategy

### 16.1 Test business logic without React

Business rules should be testable without rendering UI.

### 16.2 Test projections independently

Projection logic should be testable from input state to output state.

### 16.3 Test adapters separately

Engine, plugin host, persistence adapters, and desktop bridges should have runtime-appropriate integration tests.

### 16.4 Test RT safety where applicable

Include tests or safeguards appropriate to:

- allocation discipline
- lock avoidance
- graph swap correctness
- parameter update correctness
- queue behavior

### 16.5 Thin shell, thick core

The closer code is to UI or shell layers, the less core correctness should depend on it.

---

## 17. Worked examples

## 17.1 Example: user drags a volume fader

### Good flow

```text
UI drag
  -> application action
  -> coalesced command
  -> project truth update
  -> engine parameter projection
  -> parameter channel
  -> runtime applies value
  -> telemetry updates meter display
```

### Bad flow

```text
UI drag
  -> directly mutate engine node
  -> maybe update React state
  -> maybe write project truth later
```

Why it is bad:

- truth and runtime drift apart
- undo becomes unclear
- persistence may not match what happened
- collaboration becomes harder later

## 17.2 Example: insert a plugin

### Good flow

```text
User chooses plugin
  -> application action validates
  -> project truth records plugin placement
  -> topology/update channel notifies runtime
  -> plugin host tries instantiation
  -> success: reconcile runtime graph
  -> failure: explicit error state or rollback policy
  -> parameter metadata exposed through projections
```

### Key rule

Project truth stores the fact that the plugin should exist.
Runtime state stores the actual instantiated plugin object.

---

## 18. Anti-patterns

| Anti-pattern                                       | Why it is bad                   | Preferred replacement                      |
| -------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| React state owns AudioNode or plugin instance      | UI/runtime coupling             | engine-owned runtime object                |
| one module mutates another module’s store directly | ownership leak                  | call owning application action             |
| projection store used as write API                 | hidden source of truth          | explicit command/action                    |
| command body contains business logic               | shell leakage                   | move logic to application/domain core      |
| every field change emits an event                  | event noise                     | emit only meaningful business events       |
| telemetry written back into truth automatically    | feedback loop confusion         | explicit action if commit is needed        |
| local UI detail stored globally                    | needless coupling               | local/component/view-scoped state          |
| graph rebuild on every parameter tweak             | performance failure             | separate parameter path from topology path |
| persistence code embedded in view hooks            | hidden I/O and poor testability | adapter + application workflow             |
| folder purity drives design                        | architecture theater            | design around boundaries and ownership     |

---

## 19. Practical decision checklists

## 19.1 State checklist

Before adding state, ask:

1. Is this project truth, runtime state, telemetry, UI state, or async query state?
2. Does it need persistence?
3. Does it need undo?
4. Does it depend on live runtime resources?
5. Who owns it?
6. Who may mutate it?

## 19.2 Boundary checklist

Before adding a new abstraction, ask:

1. Is this a port, adapter, projection, action, or just local helper code?
2. Does it cross a runtime boundary?
3. Does it improve ownership clarity?
4. Does it reduce hidden mutation?
5. Can it be tested without React or the desktop shell?

## 19.3 RT checklist

Before touching engine-side behavior, ask:

1. Does this touch the RT path?
2. Could this allocate or block?
3. Is this a parameter update or a topology change?
4. Can this be reconciled instead of recreated?
5. Is telemetry separated from truth?

---

## 20. Summary

The architecture is built around a few central truths:

- the real-time boundary matters more than folder purity
- the project model is the source of truth
- business logic must remain framework-free
- writes happen through explicit actions and commands
- reads happen through projections and telemetry
- runtime systems execute; they do not define business meaning
- the desktop shell is a bridge, not the core
- the codebase must converge gradually, not through ideological rewrites
- module boundaries should remain flexible so long as architectural invariants are preserved

This is the system architecture that humans and AI agents should optimize for.
