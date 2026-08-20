# Rust Backend Architecture

This document defines the **Rust-side architecture** for the DAW backend.

It explains:

- how the Rust backend maps to the overall system architecture
- which crates should exist
- what belongs in each crate
- how DDD modules map to Rust modules
- how the real-time boundary is enforced
- what belongs in `sourdaw-native` and what absolutely does not
- how commands, relays, plugin hosting, and I/O should be structured

This document is the source of truth for **Rust backend topology and runtime/backend responsibility boundaries**.

It complements:

- `DAW System Architecture` — system-level invariants and runtime model
- `TypeScript Module Architecture` — TypeScript bounded-context anatomy

---

## 1. Core principle

The backend exists to provide **native/runtime capabilities** without becoming the business core.

The most important rule is:

```text
the audio engine knows nothing about the desktop shell
and the shell knows nothing about DSP
```

`sourdaw-native` is a bridge.
The audio engine is a runtime executor.
The Rust backend should mirror the system architecture, not replace it.

---

## 2. Backend in one picture

```text
┌────────────────────────── TypeScript UI ──────────────────────────┐
│ views, hooks, actions, stores, projections                        │
└──────────────────────────────┬────────────────────────────────────┘
                               │ typed commands / streams / events
                               ▼
┌───────────────────── electron/ desktop shell ─────────────────────┐
│ IPC router, preload bridge, event path, window lifecycle          │
└──────────────────────────────┬────────────────────────────────────┘
                               │ Node addon calls
                               ▼
┌────────────────────── crates/sourdaw-native ──────────────────────┐
│ thin bridge                                                       │
│ - command bodies                                                  │
│ - singleton wiring and teardown order                             │
│ - payload translation                                             │
│ - host seams for events, streams, and plugin windows              │
└───────────────┬─────────────────────────────┬─────────────────────┘
                │                             │
                │ depends on                  │ depends on
                ▼                             ▼
┌───────────────────────┐          ┌───────────────────────────────┐
│       daw-core        │          │         daw-engine            │
│ shared types, ids,    │          │ RT + non-RT engine runtime    │
│ project models,       │          │ graph, schedule, commands     │
│ transport, routing    │          │ meters, transport execution   │
└───────────────────────┘          └───────────────────────────────┘
                │                             │
                │                             │
                ▼                             ▼
┌───────────────────────┐          ┌───────────────────────────────┐
│        daw-dsp        │          │       daw-plugin-host         │
│ pure DSP algorithms   │          │ native plugin hosting,        │
│ math, filters, etc.   │          │ scanning, editors, lifecycle  │
└───────────────────────┘          └───────────────────────────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
                     ┌───────────────────────┐
                     │        daw-io         │
                     │ files, codecs, MIDI,  │
                     │ dictation, external   │
                     │ native I/O            │
                     └───────────────────────┘
```

---

## 3. What the backend is responsible for

The Rust backend is the natural home for capabilities that are weak, missing, or fundamentally unsuitable in the browser runtime.

Typical Rust-side responsibilities include:

- native plugin hosting
- MIDI I/O
- native file dialogs and filesystem workflows
- codec decoding/encoding beyond browser reliability
- microphone/dictation pipelines when native support is better
- long-running native tasks
- native device/platform integration
- the desktop bridge
- any real-time engine that is actually running in Rust

The backend is **not** automatically the home of:

- business rules
- project ownership semantics
- arbitrary feature logic
- UI orchestration
- mutable project truth as a shell-owned singleton

---

## 4. Crate topology

For a professional DAW backend, the sweet spot is usually **4–6 crates**.

Not one monolith.
Not 20 tiny crates.

> **Sourdaw today:** the five below plus `sourdaw-native` (the shell-facing command bodies and the Node addon that exposes them), `daw-collab` (Automerge CRDT + LAN sync), `daw-wasm-decoder` (browser codec decode), `proof-chamber` (reverb), and `scoring` (tuner). The extra crates exist to isolate WASM-only build targets, the collaboration stack, and the shell-facing surface. See `crates/sourdaw-native/AGENTS.md` for its boundary rules.

A practical default is:

```text
my-daw/
├── Cargo.toml                 # workspace root
├── crates/
│   ├── daw-core/
│   ├── daw-engine/
│   ├── daw-dsp/
│   ├── daw-plugin-host/
│   ├── daw-io/
│   └── sourdaw-native/        # command bodies + Node addon
└── electron/                  # desktop shell
```

## 4.1 Why this is the right size

Too few crates causes:

- giant compile units
- poor dependency hygiene
- shell concerns creeping into core logic
- harder subsystem ownership

Too many crates causes:

- maintenance overhead
- artificial fragmentation
- noisy dependency management
- architecture theater

The goal is to create crate boundaries only where dependency/runtime differences justify them.

---

## 5. Crate responsibilities

## 5.1 `daw-core`

This is the foundation crate.

It contains:

- IDs
- units/newtypes
- shared data models
- project model fragments
- transport/routing/automation model types
- shared enums/events
- DTO-like domain-neutral shared shapes

It should contain **only data types and light supporting logic**.

### Good contents

```text
ids.rs
units.rs
project.rs
transport.rs
routing.rs
automation.rs
midi.rs
events.rs
```

### Bad contents

- shell/IPC APIs
- CPAL stream setup
- plugin scanning
- filesystem access
- command handlers
- RT callback logic

### Rule

`daw-core` should be lightweight, serializable, and widely depended on.

---

## 5.2 `daw-engine`

This crate owns the engine runtime.

It contains:

- engine handle API
- audio-thread callback
- schedule execution
- graph topology structures
- engine command protocol
- meter capture
- transport execution
- RT/non-RT boundary logic
- graph reconciliation / compiled schedule preparation

### Typical contents

```text
lib.rs
audio_thread.rs
graph.rs
commands.rs
meters.rs
transport.rs
schedule.rs
disk_stream.rs
processors/
```

### Rule

This is where the hard RT boundary is enforced.

The engine crate must not depend on the desktop shell or its IPC.

---

## 5.3 `daw-dsp`

This crate contains pure DSP algorithms.

Examples:

- filters
- dynamics
- delay/reverb math
- resampling wrappers
- waveform/peak generation
- utility DSP

### Rule

`daw-dsp` should be as pure and portable as possible.

It should not know about:

- the desktop shell
- commands
- UI
- file dialogs
- plugin windows
- business workflows

It may depend on math and DSP libraries, but not on shell/runtime integration layers.

---

## 5.4 `daw-plugin-host`

This crate owns native plugin hosting: scanning and metadata extraction, per-format integration,
instance lifecycle, the parameter access surface, editor window lifecycle support, and host/plugin
state bridging.

### Which formats it hosts

CLAP is the format Sourdaw hosts. VST3 is committed to and not yet implemented. VST2 and Audio Units
are permanently excluded. [ADR 0031](../../.agents/decisions/0031-native-plugin-format-strategy.md)
is the record, including the licensing basis for each and the obligations VST3 carries.

A format this crate does not load is still recognised, and the refusal names the format and the
reason — during a scan and again at activation, from one set of constants. Silently passing a file
over leaves a user with an empty plugin list and nothing to act on, and "unsupported" sends them
looking for a setting to turn on. A refusal for a format that will never arrive says so; one for a
format that is coming says that instead.

### What a scan may claim

Discovery reports what it read from the plugin and nothing else. A capability the scan did not query
— because the plugin does not implement the extension that answers it, or because the bounded worker
did not run — is published as a default _with the reason recorded beside it_. A default that reaches
a consumer without its reason is indistinguishable from a measurement, and the browse list, the
device factory manifest, and the persisted registry all read those fields.

Plugin entry points are loaded only inside the bounded scan worker
([ADR 0004](../../.agents/decisions/0004-plugin-hosting-security-policy.md)). Extending what
discovery asks a plugin does not extend where it asks: a new query goes to the instance the worker
already created, never to a new process and never to the application process.

### Rule

Plugin hosting is a subsystem.
Do not smear it across `sourdaw-native`, `daw-engine`, and random helpers.

It deserves its own crate because:

- dependency tree is different
- platform behavior is different
- lifecycle complexity is high
- failure semantics are special

---

## 5.5 `daw-io`

This crate owns nontrivial native I/O.

Examples:

- project file read/write
- audio codec decode/encode
- MIDI I/O
- dictation/audio capture support
- filesystem workflows
- import/export helpers

### Rule

This is not a “misc” crate.
It is specifically for external/native I/O concerns that do not belong in the engine or bridge.

---

## 5.6 `sourdaw-native`

This is the shell-facing crate: the command bodies, plus the Node addon — behind the off-by-default
`napi-addon` feature — that the Electron main process loads.

It contains:

- command bodies, taking plain owned arguments and returning plain owned results
- app state and singleton wiring, whose field order is the teardown order
- host seams for events, streams, and plugin windows, implemented by the shell
- API error translation
- the addon registration that exposes the bodies to a shell

It should not contain:

- DSP
- domain ownership logic
- plugin-host internals
- engine internals
- large business workflows
- the name of any shell — no IPC transport type reaches this crate

`sourdaw-native` is where the backend meets a product shell, not where core backend logic should
live. The shell unwraps transport and calls a body; wire payload types are hand-maintained on both
sides, because no binding generator runs.

---

## 6. DDD modules vs Rust crates

A critical distinction:

- **TypeScript modules** are bounded contexts / ownership boundaries
- **Rust crates** are compilation and dependency boundaries

These are not the same thing.

### Correct mapping

The DAW’s DDD modules usually map to **Rust modules inside crates**, not one crate per domain.

Example:

```text
daw-core/
  src/
    project.rs
    transport.rs
    routing.rs
    automation.rs
    midi.rs
```

not:

```text
bad-idea/
  daw-project/
  daw-transport/
  daw-routing/
  daw-automation/
  daw-midi/
```

### Why

If every bounded context becomes its own Rust crate, you usually get:

- too many crates
- too much ceremony
- dependency pain
- weak justification for the split

Use crates for **runtime/dependency boundaries**.
Use Rust modules and visibility for **domain boundaries**.

---

## 7. Visibility and public API discipline

Rust’s visibility system is how you enforce internal boundaries.

Use:

- `pub` for real public API
- `pub(crate)` for crate-internal sharing
- private modules/items by default

### Example

```rust
// daw-engine/src/lib.rs
mod audio_thread;
mod graph;
mod commands;
mod meters;
pub mod processors;

pub struct EngineHandle {
    // ...
}

impl EngineHandle {
    pub fn new(...) -> Self { ... }
    pub fn play(&self) { ... }
    pub fn stop(&self) { ... }
    pub fn seek(&self, position: Beats) { ... }
}
```

### Rule

Expose the smallest stable surface possible.

Other crates should interact with `daw-engine` through something like `EngineHandle`, not by importing internal graph or audio-thread machinery.

---

## 8. The real-time boundary

This is the most important backend boundary.

## 8.1 RT vs non-RT in one picture

```text
NON-RT SIDE
- graph ownership
- schedule compilation
- command preparation
- plugin/editor management
- file I/O
- shell bridging
- background tasks

            │ lock-free commands / snapshots / atomics │

RT SIDE
- callback execution
- process DSP
- apply parameter changes
- consume compiled schedule
- produce telemetry
```

## 8.2 RT rules

On the RT path, never:

- allocate unpredictably
- block
- lock mutexes
- perform filesystem/network I/O
- call into the shell or its IPC
- call UI code
- parse/serialize data
- open plugin windows
- scan plugins
- log excessively
- do dynamic graph traversal if a compiled representation is intended

## 8.3 What the RT side should consume

The RT side should consume:

- immutable compiled schedules
- lock-free command queues
- atomics/triple-buffer snapshots
- preallocated buffers
- prevalidated runtime-ready structures

It should not be asked to “figure out” project semantics in the callback.

---

## 9. Engine architecture

## 9.1 The engine owns runtime execution, not business meaning

The engine should know how to:

- play
- stop
- seek
- process
- apply parameter changes
- execute schedules
- update meters
- manage runtime graph objects

It should not define:

- what a track means
- what a bus means semantically
- project save semantics
- UI state semantics

## 9.2 The engine handle pattern

A good backend engine usually exposes a non-RT-facing handle such as:

```text
EngineHandle
  - play()
  - stop()
  - seek()
  - set_parameter(...)
  - swap_schedule(...)
  - get_meter_data()
```

This handle:

- lives on the non-RT side
- owns command queues/shared state for RT communication
- is the stable integration API for the shell/bridge

## 9.3 Compiled schedule pattern

The recommended pattern is:

```text
project/runtime graph (non-RT)
  -> topological analysis / compilation
  -> flat compiled schedule
  -> RT thread consumes schedule
```

Why:

- avoids graph traversal on the RT path
- improves cache locality
- makes structural changes occur on the non-RT side
- cleanly separates topology changes from runtime execution

---

## 10. Commands, streams, and relays

## 10.1 Commands

Use commands for explicit request/response operations.

Examples:

- `play`
- `stop`
- `seek`
- `open_project`
- `save_project`
- `scan_plugins`
- `list_midi_ports`

### Command rules

Command bodies should:

- extract typed input
- access app state
- delegate to backend/core logic
- translate errors cleanly

They should not become the business layer.

## 10.2 Streams and relays

Use streams/relays for streamed feedback.

Examples:

- meter snapshots
- transport updates
- waveform generation progress
- token streaming
- plugin scan progress

### Relay role

A relay exists to:

- drain backend/runtime feedback
- reshape it into frontend-safe payloads
- push it outward over a shell-friendly mechanism

A relay is not the source of truth.

---

## 11. Plugin host integration

## 11.1 Project plugin state vs runtime plugin state

Project/plugin truth may store:

- plugin identity
- slot placement
- saved parameter values
- preset references
- automation targets

Runtime/plugin-host state may store:

- live instance
- native handle
- editor window
- host communication state
- processing buffers

These are different things and must stay different.

## 11.2 Editor windows are runtime/UI concerns

Opening a plugin editor is not a project-truth write by default.

The plugin host must support:

- instance lifecycle
- parameter access
- state save/restore
- editor lifecycle
- failure handling

without forcing the vendor GUI to be the only way to interact with the plugin.

## 11.3 Fast path vs slow path

Fast path:

- parameter updates
- RT-safe plugin processing

Slow path:

- scan/discovery
- instantiate/unload
- editor windows
- metadata reads
- failure recovery

Keep these separate.

---

## 12. Persistence and I/O

## 12.1 Persistence belongs in explicit I/O layers

Project save/load, import/export, codec work, and filesystem integration should live in dedicated I/O crates/modules.

Do not bury them inside:

- command bodies
- engine code
- UI bridge glue

## 12.2 Caches are not truth

Waveform caches, plugin scan caches, previews, thumbnails, and similar artifacts are not authoritative truth.

They should be:

- regenerable
- separately invalidatable
- clearly distinguished from project data

---

## 13. App state in `sourdaw-native`

The bridge usually needs one application state object.

Good example:

```text
AppState
  - engine handle
  - project manager / persistence manager
  - plugin host manager
  - event/relay channels
```

### Rule

App state should store handles/managers for native capabilities.
It should not become a giant business-domain state object duplicating the frontend’s project truth.

---

## 14. Typed boundaries

Typed boundaries are strongly preferred.

The frontend/backend boundary should use:

- explicit DTOs
- serializable types
- generated bindings where possible
- stable error shapes

### Good backend boundary principles

- IDs are newtypes internally, clean scalar shapes externally
- enums are explicit
- errors are structured
- commands are typed
- channels stream explicit payloads

---

## 15. Error handling

Backend errors should be translated at the bridge boundary.

### Good error categories

- not found
- invalid input
- engine/runtime failure
- I/O failure
- plugin-host failure
- unsupported capability

### Rule

Do not leak raw internal error chains directly to the frontend as your API contract.

The shell should translate internal failures into stable frontend-facing errors.

---

## 16. Testing strategy

## 16.1 Test core logic outside the shell

The majority of correctness should be testable without booting a desktop shell.

Test directly in:

- `daw-core`
- `daw-dsp`
- `daw-engine`
- `daw-plugin-host`
- `daw-io`

## 16.2 Test RT-sensitive behavior explicitly

Where relevant, include tests/safeguards for:

- allocation discipline
- lock avoidance
- schedule swapping
- command queue correctness
- parameter update correctness
- graph compilation validity

## 16.3 Thin shell, thick core

The closer code is to the shell boundary, the less core correctness should depend on it.

Shell wrapper tests should mostly verify:

- wiring
- translation
- error mapping
- state access
  not DSP/business correctness.

---

## 17. Canonical backend layout

## 17.1 Workspace layout

```text
my-daw/
├── Cargo.toml
├── crates/
│   ├── daw-core/
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── ids.rs
│   │       ├── units.rs
│   │       ├── project.rs
│   │       ├── transport.rs
│   │       ├── routing.rs
│   │       ├── automation.rs
│   │       ├── midi.rs
│   │       └── events.rs
│   ├── daw-engine/
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── audio_thread.rs
│   │       ├── graph.rs
│   │       ├── schedule.rs
│   │       ├── commands.rs
│   │       ├── meters.rs
│   │       └── processors/
│   ├── daw-dsp/
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── filters.rs
│   │       ├── dynamics.rs
│   │       ├── delay.rs
│   │       ├── reverb.rs
│   │       └── waveform.rs
│   ├── daw-plugin-host/
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── scanner.rs
│   │       ├── traits.rs
│   │       └── clap_host.rs
│   ├── daw-io/
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── project_file.rs
│   │       ├── audio_decode.rs
│   │       ├── audio_encode.rs
│   │       ├── midi_io.rs
│   │       └── dictation.rs
│   └── sourdaw-native/
│       └── src/
│           ├── lib.rs
│           ├── state.rs
│           ├── shutdown.rs
│           ├── events.rs
│           ├── addon/
│           ├── host/
│           └── commands/
│               ├── mod.rs
│               ├── plugins.rs
│               ├── midi.rs
│               └── filesystem.rs
└── electron/
    ├── main.ts
    ├── preload.ts
    ├── router.ts
    └── commands.ts
```

---

## 18. What belongs where: quick lookup table

| Problem                                        | Put it in                 |
| ---------------------------------------------- | ------------------------- |
| TrackId, ClipId, Beats, Decibels               | `daw-core`                |
| Project state shape                            | `daw-core`                |
| Engine handle and RT command protocol          | `daw-engine`              |
| Audio-thread callback                          | `daw-engine`              |
| Pure filter/reverb/compressor math             | `daw-dsp`                 |
| Plugin scanning/instantiation/editor lifecycle | `daw-plugin-host`         |
| MIDI I/O / project files / codecs              | `daw-io`                  |
| native command bodies                          | `sourdaw-native/commands` |
| frontend-safe meter stream relay               | `sourdaw-native/events`   |
| app-wide native handles/managers               | `sourdaw-native/state`    |

---

## 19. Anti-patterns

| Anti-pattern                                         | Why it is bad                             | Preferred replacement                   |
| ---------------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| command body owns business workflow                  | shell becomes domain layer                | thin command, delegate inward           |
| engine depends on the shell                          | shell/runtime coupling                    | engine crate stays shell-free           |
| one crate per DDD module                             | over-fragmentation                        | DDD modules as Rust modules, not crates |
| RT callback allocates/locks/does I/O                 | violates RT boundary                      | precompute and use lock-free paths      |
| plugin host logic scattered through shell and engine | weak subsystem ownership                  | dedicated plugin-host crate             |
| app state duplicates project truth                   | backend becomes competing source of truth | store native handles/managers only      |
| raw internal errors leaked directly                  | unstable API contract                     | translate at bridge boundary            |
| relay becomes business logic owner                   | read path becomes write path              | relay only forwards/reshapes feedback   |
| `daw-io` becomes a generic junk drawer               | loss of architectural clarity             | keep it focused on native I/O concerns  |

---

## 20. Review checklist

Before accepting Rust backend architecture work, verify:

1. Is the crate split justified by runtime/dependency boundaries rather than aesthetics?
2. Is `sourdaw-native` staying thin?
3. Does the engine remain shell-free?
4. Are DDD modules represented as Rust modules rather than too many crates?
5. Is the RT boundary explicit and respected?
6. Are commands/channels/relays used for the right kinds of communication?
7. Are plugin hosting and I/O treated as proper subsystems?
8. Is app state holding native handles/managers rather than duplicating project truth?
9. Are typed boundaries and translated errors preserved?
10. Did the change reduce or increase shell leakage into the core?

---

## 21. Summary

The Rust backend should be shaped around a few core truths:

- crates exist for runtime/dependency boundaries, not for every domain concept
- DDD modules usually map to Rust modules, not separate crates
- `sourdaw-native` is a bridge, not the business core
- the engine is RT-sensitive and must stay isolated from shell concerns
- plugin hosting and native I/O are subsystems, not random helpers
- typed boundaries and narrow public APIs matter
- the shell should stay thin and the core should stay testable

The backend is successful when it gives the DAW strong native capabilities **without stealing ownership from the real architecture**.
