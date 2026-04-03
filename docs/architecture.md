# DAW System Architecture

This document defines the unified architecture for the DAW across frontend, backend, engine, persistence, plugin hosting, and future collaboration concerns.

It is intentionally centered on architectural rules, ownership, and decision-making rather than fixed module catalogs. Humans and AI agents are expected to create, merge, split, or retire modules as the codebase changes, as long as they preserve the invariants and boundaries defined here.

This document is the source of truth for architecture.

---

## 1. Purpose

The architecture exists to solve these constraints at once:

1. The DAW must support real-time audio safely.
2. Business logic must remain framework-free and runtime-agnostic.
3. The codebase must remain operable despite existing shortcuts and inconsistency.
4. AI agents must have enough guidance to make good structural decisions without becoming mechanically constrained.
5. The system must support multiple runtime implementations, including browser-only and Tauri/Rust-backed execution.
6. The architecture must support gradual convergence rather than requiring large rewrites.

This is not a greenfield purity document. It is a decision system for evolving a large codebase safely.

---

## 2. Architectural invariants

These rules are non-negotiable.

### 2.1 The real-time boundary is absolute

Nothing on the audio real-time path may:

- allocate unpredictably
- block
- acquire locks
- touch React state
- perform file I/O
- perform network I/O
- depend on slow IPC
- depend on browser rendering lifecycles

All real-time state must be prepared ahead of time and handed to the engine through real-time-safe mechanisms.

### 2.2 The project model is the source of truth

All persistent, serializable, undoable state lives in the project model.

The engine is not the source of truth. The plugin host is not the source of truth. The UI is not the source of truth. They are all projections, views, adapters, or runtime executors derived from the project model and command flow.

### 2.3 Business logic is React-free

Business logic must not depend on React, hooks, JSX, component trees, or widget lifecycle details.

React is presentation only.

### 2.4 Tauri is a bridge, not the core

Tauri is an integration shell.

It is not the business layer, not the engine, and not the domain model.

Any logic that matters outside the shell must live outside Tauri-specific code.

### 2.5 Architecture is defined by boundaries, not folders

Folder structure is an implementation detail. Architectural compliance is determined by:

- dependency direction
- ownership
- mutation authority
- runtime constraints
- boundary clarity

A messy folder tree with correct boundaries is better than a beautiful folder tree with leaking abstractions.

### 2.6 Commands change state; projections observe state

Writes and reads are different concerns.

- Writes happen through explicit actions and commands.
- Reads happen through selectors, stores, projections, read models, and telemetry streams.

State synchronization does not replace business meaning.

### 2.7 Prefer convergence over rewrites

The codebase already exists and contains shortcuts.

The rule for legacy code is:

- do not preserve architectural debt out of convenience
- do not rewrite stable code merely for aesthetics
- improve boundaries when touching code
- move toward the target architecture incrementally

---

## 3. System topology

The system has six conceptual layers.

### 3.1 Presentation layer

Responsibilities:

- render views
- manage local UI interaction
- bind user intent to application actions
- subscribe to projections and stores
- display telemetry
- perform rendering-specific work such as canvas, WebGL, or WebGPU drawing

This layer may use React, refs, requestAnimationFrame, and external stores.

This layer does not define business rules.

### 3.2 Application layer

Responsibilities:

- define user-intent actions and use cases
- validate input at the application boundary
- call domain logic
- invoke ports and adapters
- commit project mutations
- emit meaningful business events
- coordinate undo/redo and coalescing
- trigger persistence or runtime updates indirectly

This is the preferred write boundary.

### 3.3 Domain layer

Responsibilities:

- define business types
- define invariants
- define pure domain rules
- define calculations and policies
- define business-significant events and errors

This layer is plain code. No React. No Tauri. No direct browser API. No raw runtime handles.

### 3.4 Projection layer

Responsibilities:

- derive engine instructions from project state
- derive UI-facing views from project state
- maintain caches and indexes
- expose selector-driven stores
- expose telemetry snapshots
- maintain non-authoritative computed state

A projection is not allowed to become an alternate write model.

### 3.5 Runtime/infrastructure layer

Responsibilities:

- audio engine integration
- plugin hosting
- MIDI integration
- file I/O
- IndexedDB/local storage access
- Tauri commands/events/channels
- browser API integration
- platform-specific bridges
- persistence and codec integration

This layer implements ports required by the application layer.

### 3.6 Real-time engine layer

Responsibilities:

- process audio
- execute compiled schedules or equivalent plans
- apply real-time-safe parameter changes
- report telemetry through safe channels
- host runtime DSP state and engine-owned state

This layer must remain isolated from UI and non-real-time business mutation.

---

## 4. State model

Every state value must belong to one category.

## 4.1 State categories

| State category        | Source of truth          | Who may write                          | Persistence | Typical examples                                          | Anti-pattern                                |
| --------------------- | ------------------------ | -------------------------------------- | ----------- | --------------------------------------------------------- | ------------------------------------------- |
| Project state         | Project model            | Application actions of owning feature  | Yes         | clips, routing, automation, plugin values, tempo, markers | storing runtime handles here                |
| Shared runtime state  | Runtime/projection layer | Runtime adapters or owning app actions | Sometimes   | engine ready, MIDI device list, plugin scan results       | treating it as project truth                |
| Persistent UI state   | UI preferences layer     | Presentation logic                     | Local only  | zoom, panel layout, sidebar open                          | saving this into project automatically      |
| Ephemeral UI state    | Presentation layer       | Presentation logic                     | No          | selection, active tool, drag state                        | sharing globally without need               |
| Local component state | Component                | Component                              | No          | input draft, hover flag                                   | using global store for it                   |
| Engine state          | Engine/runtime           | Engine/runtime only                    | No          | AudioContext, AudioNodes, DSP buffers, plugin instances   | storing in React state or project store     |
| Telemetry state       | Runtime feedback         | Runtime/relay layer                    | No          | meters, playhead display, underruns, CPU load             | feeding it back into project state directly |

## 4.2 State tool decision matrix

| Need                                           | Preferred tool                        |
| ---------------------------------------------- | ------------------------------------- |
| Saved with project                             | Project state                         |
| Shared across features but not part of project | Shared runtime state                  |
| Survives refresh but only affects UI           | Persistent UI state                   |
| View-local interaction state                   | Context or local store scoped to view |
| Component-only transient state                 | Local component state                 |
| Audio execution/runtime object                 | Engine/runtime state                  |
| High-frequency read-only feedback              | Telemetry channel / projection        |

## 4.3 State rules

- Project state must be serializable.
- Engine state must never live in React state or project stores.
- Telemetry is not project state.
- UI preference state is not project state unless explicitly part of the product semantics.
- If a value is undoable, it almost certainly belongs in project state.
- If a value depends on live runtime resources, it does not belong in project state.

---

## 5. Ownership and mutation rules

### 5.1 Every authoritative state slice has one owner

Every slice of project state has one owning business area. Only its public application actions may mutate that slice directly.

Other code may:

- read it
- request changes through public actions
- react to meaningful events
- derive projections from it

It may not mutate it directly.

### 5.2 Cross-boundary changes must use actions, not ad hoc mutation

If one feature needs another feature’s state changed, it must:

- call that feature’s public action
- or submit a command handled by the owning area
- or emit a meaningful event another handler reacts to

It must not reach into another feature’s internals and mutate them.

### 5.3 Projections are read-oriented

Projection stores may exist, but they must not become unofficial write backdoors.

### 5.4 Runtime state is engine-owned

React state, context, and project stores must not own:

- AudioNodes
- plugin handles
- engine object instances
- native runtime pointers
- long-lived backend handles

### 5.5 Persistence derives from project state

Save/load must operate on authoritative project state, not on arbitrary UI snapshots or runtime state.

---

## 6. Write model

### 6.1 The system uses explicit write actions

Business changes enter through explicit application actions.

An action should:

- express intent
- validate input
- enforce rules
- update authoritative state
- emit meaningful events where appropriate
- support undo/redo
- be representable for collaboration later

### 6.2 Commands are the preferred write envelope

Internally, the architecture prefers a command-oriented write model.

This does not require full event sourcing. It does require mutations to be:

- intentional
- representable
- undoable
- coalescible
- replayable where useful

Commands are the canonical record of user intent.

### 6.3 Continuous edits must support coalescing

High-frequency interactions such as:

- fader drags
- knob twists
- automation edits
- clip drags
- scrubbing

must be grouped into meaningful undo units.

### 6.4 Events are for significance, not for everything

Use an event when:

- another concern must react independently
- the occurrence matters for undo/history/collaboration
- the event has business meaning

Do not create events just because a field changed.

---

## 7. Read model

### 7.1 Reads are projection-driven

The system exposes reads through projections, selectors, caches, query models, and telemetry channels rather than arbitrary mutable objects.

### 7.2 Projection types

| Projection type      | Purpose                                          | Examples                                            |
| -------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Engine projection    | turn project truth into runtime instructions     | graph descriptions, parameter snapshots             |
| UI projection        | turn project truth into view-friendly structures | flattened lane lists, clip summaries                |
| Derived read model   | optimize complex queries                         | search indexes, browser groupings, precomputed maps |
| Telemetry projection | turn runtime feedback into display data          | meter snapshots, CPU display, waveform progress     |

### 7.3 Projection rules

- A projection may be stale briefly.
- A projection must be derivable.
- A projection must be disposable.
- A projection must not become a hidden source of truth.

---

## 8. Boundary contracts

The architecture relies on explicit contracts at boundaries.

### 8.1 Ports

Ports describe what the application layer needs from the outside world.

Examples:

- engine control
- plugin host
- project persistence
- codec access
- MIDI runtime
- telemetry streams
- ID generation
- clock/time providers

Ports are technology-neutral.

### 8.2 Adapters

Adapters implement ports for specific runtimes.

Examples:

- Web Audio adapter
- Tauri engine adapter
- Rust plugin host adapter
- IndexedDB adapter
- file-system adapter
- local storage adapter
- browser MIDI adapter
- Rust MIDI adapter

### 8.3 DTOs and transport payloads

Cross-runtime payloads must be:

- serializable
- stable enough for interop
- free of runtime handles
- explicit in meaning

### 8.4 Typed boundaries are preferred

Where possible, boundaries should be generated or validated from shared types so drift is minimized.

### 8.5 Port vs adapter vs projection

| Concept    | Question it answers                        | Example                                 |
| ---------- | ------------------------------------------ | --------------------------------------- |
| Port       | what capability does the application need? | plugin host, project persistence        |
| Adapter    | how is that capability implemented here?   | Rust plugin adapter, IndexedDB adapter  |
| Projection | how is state exposed for reads?            | track view store, meter snapshot stream |

---

## 9. React and store usage

### 9.1 React belongs only to presentation

React components, hooks, contexts, and rendering logic belong to presentation.

Business logic must remain usable without React.

### 9.2 External stores are synchronization tools

External stores are useful for:

- cross-component sync
- query snapshots
- view subscriptions
- shared runtime state
- projection exposure

They are not a substitute for domain logic, command handling, or business events.

### 9.3 useSyncExternalStore is an adapter pattern

It is a good way to connect React to external stores or projections.

It is not a reason to move business rules into store code.

### 9.4 Context is view-scoped

Context is appropriate for view-scoped ephemeral state.

It is not the default solution for app-wide business state.

### 9.5 High-frequency displays may bypass React state

Meters, playback position, waveform displays, and similar fast-updating visuals may use:

- refs
- requestAnimationFrame
- imperative drawing
- direct telemetry subscriptions

This is a performance pattern, not a write-model loophole.

## 9.6 UI state decision table

| Situation                      | Use                                  |
| ------------------------------ | ------------------------------------ |
| Text input draft               | local component state                |
| Active editor tool             | context or view-local store          |
| Selected clips/tracks          | context or ephemeral UI store        |
| Project tempo                  | project state via application action |
| Meter display                  | telemetry + ref/render loop          |
| Audio engine instance          | runtime layer                        |
| App-wide hardware capabilities | shared runtime store                 |

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
- Telemetry must not directly mutate project state.
- Persistence operations must stay outside the real-time path.

---

## 11. Engine architecture principles

### 11.1 The engine is a runtime executor

The engine executes prepared state and runtime instructions. It does not define the business meaning of tracks, clips, or project semantics.

### 11.2 The engine owns execution resources

The engine owns:

- audio context or backend stream handles
- runtime graph/node instances
- DSP object lifecycle
- real-time-safe buffers
- transport execution state
- meter generation

### 11.3 The engine consumes projections

Business/application code prepares the state the engine needs in a runtime-friendly form.

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

## 12. Plugin-host architecture principles

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

These are not the same thing and must not be conflated.

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

If the system supports VST3/CLAP through Tauri/Rust, that belongs behind ports and adapters.

### 12.5 Built-in devices and hosted plugins should align conceptually

Where practical, the project model should expose a shared conceptual surface:

- instance identity
- parameter model
- preset references
- automation targets
- routing participation

This does not require identical runtime implementations.

---

## 13. Persistence architecture principles

### 13.1 Persistence is based on project state

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

## 15. Error handling principles

### 15.1 Errors should be meaningful where they surface

Expose structured application-meaningful errors at public boundaries.

### 15.2 Runtime failures must not silently corrupt truth

The system must make clear whether:

- the project mutation committed
- the runtime update committed
- recovery is possible

### 15.3 Shell/framework errors are translated

Tauri or browser-specific errors should be wrapped into stable application-facing structures.

---

## 16. Testing strategy

### 16.1 Test business logic without React

Business rules should be testable without rendering UI.

### 16.2 Test projections independently

Projection logic should be testable from input state to output state.

### 16.3 Test adapters separately

Engine, plugin host, persistence adapters, and Tauri bridges should have runtime-appropriate integration tests.

### 16.4 Test real-time safety where applicable

Include tests or safeguards appropriate to:

- allocation discipline
- lock avoidance
- graph swap correctness
- parameter update correctness
- queue behavior

### 16.5 Thin shell, thick core

The closer code is to UI or shell layers, the less core correctness should depend on it.

---

## 17. Canonical structure shapes

These are examples, not laws. They exist to help humans and AI agents choose a reasonable starting shape.

### 17.1 Small feature

Use when:

- logic is modest
- ownership is simple
- little infrastructure is involved

```text
feature/
  model.ts
  actions.ts
  ports.ts
  store.ts
  view.tsx
```

### 17.2 Standard feature

Use when:

- there is real business logic
- there are explicit write actions
- there is at least one projection

```text
feature/
  domain.ts
  application.ts
  ports.ts
  projections.ts
  view.tsx
```

### 17.3 Runtime-heavy feature

Use when:

- runtime integration is significant
- there is engine/plugin/MIDI/backend complexity
- telemetry or reconciliation is involved

```text
feature/
  domain.ts
  application.ts
  ports.ts
  adapter.ts
  runtime/
  projections.ts
  telemetry.ts
  view.tsx
```

### 17.4 Presentation-only feature

Use when:

- there is no independent business logic
- the feature is only a view over other state

```text
feature/
  selectors.ts
  store.ts
  context.tsx
  renderers/
  view.tsx
```

### 17.5 Bridge/backend area

Use when:

- code exists only to expose external/runtime capabilities
- the business logic lives elsewhere

```text
bridge/
  commands.ts
  events.ts
  relay.ts
  adapter.ts
  dto.ts
```

### 17.6 Shape selection rules

Prefer the smallest shape that preserves:

- correct ownership
- explicit write boundary
- clear runtime separation
- future maintainability

Do not split code just to satisfy a template.
Do not merge unrelated concerns just to reduce file count.

---

## 18. Worked examples

## 18.1 Example: user drags a volume fader

### Intent flow

1. User drags a fader in the UI.
2. Presentation code captures the interaction.
3. Application action receives the intent.
4. A coalesced command is created or updated.
5. Authoritative project state is updated.
6. Projection/store updates visible UI state.
7. Engine parameter projection emits a fast parameter update.
8. Runtime applies the parameter safely.
9. Telemetry flows back for meters/display.

### Good flow

```text
UI interaction
  -> action/command
  -> project mutation
  -> projection update
  -> parameter channel
  -> engine applies value
  -> telemetry back to UI
```

### Bad flow

```text
UI interaction
  -> directly mutate engine
  -> maybe update React state
  -> maybe update project later
```

Why it is bad:

- project truth and runtime drift apart
- undo semantics become unclear
- collaboration later becomes harder
- persistence may not match what user actually did

## 18.2 Example: insert a plugin

### Intent flow

1. User chooses a plugin.
2. Application action validates insertion intent.
3. Project state records plugin instance metadata and placement.
4. Runtime adapter receives a topology update.
5. Plugin host attempts instantiation.
6. If successful, runtime graph is reconciled.
7. If the plugin editor is opened, presentation binds to runtime editor surface through adapter contracts.
8. Parameter metadata is exposed through projections for automation and UI.
9. Telemetry and runtime errors remain outside project truth unless explicitly committed.

### Key rule

Project state stores the fact that the plugin should exist.
Runtime state stores the actual instantiated plugin object.

If runtime instantiation fails, the system must define whether:

- the project mutation is rolled back
- the project retains the intended plugin in a failed state
- the failure becomes a recoverable action state

That choice must be explicit.

---

## 19. Anti-patterns

| Anti-pattern                                            | Why it is bad                   | Preferred replacement                         |
| ------------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| React state owns AudioNode or plugin instance           | UI/runtime coupling             | engine-owned runtime object                   |
| feature mutates another feature’s store directly        | ownership leak                  | call owning application action                |
| projection store used as write API                      | hidden source of truth          | explicit command/action                       |
| Tauri command contains business logic                   | shell leakage                   | move logic to application/domain core         |
| every field change emits an event                       | event noise                     | emit only meaningful business events          |
| telemetry written back into project state automatically | feedback loop confusion         | explicit action if commit is needed           |
| local UI detail stored globally                         | needless coupling               | local/component/view-scoped state             |
| graph rebuild on every parameter tweak                  | performance failure             | separate parameter path from topology path    |
| persistence code embedded in view hooks                 | hidden I/O and poor testability | infrastructure adapter + application workflow |
| folder purity drives design                             | architecture theater            | design around boundaries and ownership        |

---

## 20. Guidance for AI agents and maintainers

### 20.1 Do not infer architecture from accidental shortcuts

Existing code may violate the ideal architecture. Treat this document as the target, not every current implementation detail.

### 20.2 Improve the nearest boundary

When touching messy code:

- strengthen ownership
- remove illegal dependencies
- isolate infrastructure
- move logic out of views
- replace hidden mutation with actions

Avoid creating new architecture layers unless they solve a real problem.

### 20.3 Choose granularity pragmatically

When creating or changing a feature boundary, optimize for:

- coherent ownership
- minimal cross-boundary mutation
- invariant locality
- runtime safety
- maintainability under AI-assisted development

### 20.4 Use the smallest structure that preserves the rules

Prefer:

- one cohesive feature area over many ceremonial folders
- one clear public action over multiple thin wrappers
- one explicit adapter over hidden framework coupling
- one projection store over duplicated read paths

### 20.5 Legacy tolerance is temporary

Shortcut code may remain temporarily. New work should not extend bad boundaries unless absolutely necessary.

---

## 21. Migration and convergence policy

### 21.1 New code follows the target architecture

New feature work should follow these rules unless there is a documented reason not to.

### 21.2 Existing code is improved opportunistically

When touching existing code:

- move business logic out of UI code
- replace direct cross-feature mutation with public actions
- separate project state from runtime state
- extract ports/adapters where external APIs leak inward
- isolate projections from authoritative writes

### 21.3 Do not pursue mass folder churn

Renaming and moving code for cosmetic alignment is lower priority than clarifying boundaries and ownership.

### 21.4 Preserve behavioral stability

Architecture work must not casually destabilize:

- engine behavior
- transport correctness
- persistence
- plugin hosting
- undo/redo
- automation

### 21.5 Prefer compatibility shims over big-bang rewrites

Use transitional adapters, compatibility stores, or bridge functions when needed to move safely toward the target architecture.

---

## 22. Practical decision checklists

## 22.1 State checklist

Before adding state, ask:

1. Is this project state, runtime state, telemetry, or UI state?
2. Does it need persistence?
3. Does it need undo?
4. Does it depend on live runtime resources?
5. Who owns it?
6. Who may mutate it?

## 22.2 Boundary checklist

Before adding a new abstraction, ask:

1. Is this a port, adapter, projection, action, or just local helper code?
2. Does it cross a runtime boundary?
3. Does it improve ownership clarity?
4. Does it reduce hidden mutation?
5. Can it be tested without React or Tauri?

## 22.3 Feature shape checklist

Before creating folders/files, ask:

1. Is this feature small, standard, runtime-heavy, or presentation-only?
2. Does it need its own projection?
3. Does it need explicit ports/adapters?
4. Does it have independent business rules?
5. Is the chosen shape the smallest one that preserves the rules?

## 22.4 Real-time checklist

Before touching engine-side behavior, ask:

1. Does this touch the RT path?
2. Could this allocate or block?
3. Is this a parameter update or a topology change?
4. Can this be reconciled instead of recreated?
5. Is telemetry separated from truth?

---

## 23. Summary

The architecture is built around a few central truths:

- the real-time boundary matters more than folder purity
- the project model is the source of truth
- business logic must remain framework-free
- writes happen through explicit actions and commands
- reads happen through projections and telemetry
- runtime systems execute, they do not define business meaning
- Tauri is a shell and bridge, not the core
- the codebase must converge gradually, not through ideological rewrites
- module boundaries should remain flexible so long as architectural invariants are preserved

This is the architecture humans and AI agents should optimize for.
