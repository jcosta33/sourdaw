---

name: web-audio-engine
description: Apply when creating, editing, or reviewing the browser audio engine, transport, routing, scheduling, clip playback, buses, automation, metering, offline rendering, or AudioWorklet-based DSP. This is the authoritative skill for browser-side audio execution and real-time-safe Web Audio architecture.

---

# SKILL: web-audio-engine

## Purpose

This skill exists to keep the browser audio engine correct, fast, deterministic, and architecturally aligned.

The browser audio engine is not:

- a UI concern
- a global state bucket
- a convenience layer for random audio operations
- a second source of truth

The browser audio engine **is**:

- the runtime executor for audio playback and processing
- the owner of live timing and transport execution
- the owner of browser-side graph topology
- the owner of worklet lifecycle and scheduling windows
- a derived projection of authoritative project state

This skill should be applied to any code touching:

- transport timing
- clip scheduling
- playback position
- routing or buses
- automation application
- worklet processors
- metering taps
- offline rendering
- low-latency audio behavior

---

## Architectural role

### The engine is a runtime executor, not the business model

Project truth lives outside the engine.

The engine consumes a projection of project truth and turns it into runtime execution.

Project truth may include:

- tracks
- clips
- routing definitions
- plugin/device chains
- automation data
- transport configuration
- markers
- saved parameter values

The engine may own:

- live playback state
- runtime graph objects
- scheduling windows
- transport execution state
- meter accumulators
- temporary runtime caches
- worklet nodes
- runtime-only latency state

The engine must not become the owner of persisted semantics.

### The engine owns time, routing, and playback execution

The UI may:

- send commands
- request transport changes
- request parameter changes
- subscribe to summarized engine state
- display meters, playhead, timing readouts, and transport state

The UI must not:

- own playback time
- own routing topology
- mix audio
- schedule clips directly
- mutate the live graph ad hoc
- keep transport truth in React state

---

## Core rules

### 1. Use one live `AudioContext`

The live browser engine should be rooted in one `AudioContext`.

Do not create separate contexts for unrelated features such as:

- mixer
- transport
- preview playback
- metering
- plugin wrappers

Use one live context for:

- source nodes
- worklet nodes
- buses
- automation targets
- metering taps
- monitor outputs
- built-in devices

Use explicit separate offline contexts only for offline render/export workflows.

### 2. Use `AudioWorklet` for custom real-time DSP

Any custom low-latency DSP must run in `AudioWorklet`.

Use worklets for:

- gain/pan utility processors
- metering taps
- clip playback/mixing helpers
- sample-accurate automation application
- low-latency analysis
- custom filters/processors
- buffer-domain utilities

Do not use `ScriptProcessorNode`.

### 3. Use `AudioParam` whenever possible

When a value can be driven with `AudioParam`, prefer it.

Good `AudioParam` candidates:

- gain
- pan
- filter cutoff/resonance
- envelope-driven parameters
- time-varying FX parameters
- automation targets

Do not simulate sample-accurate control with React state, UI timers, or arbitrary polling loops.

### 4. Separate parameter changes from topology changes

This distinction is critical.

#### Parameter changes

Examples:

- fader movement
- pan change
- mute/bypass
- automation values
- parameter modulation
- plugin/device parameter updates

These should use fast paths:

- `AudioParam`
- direct engine parameter application
- real-time-safe command paths
- lightweight node-local updates

These must **not** rebuild the graph.

#### Topology changes

Examples:

- add/remove track
- add/remove bus
- add/remove plugin/device
- routing rewiring
- send/return changes
- clip source replacement if it changes node structure

These may use slower reconciliation paths.

### 5. Reconcile rather than recreate

The engine should prefer targeted reconciliation over full teardown/rebuild.

Good reconciliation granularity:

- apply changed parameter only
- update changed routing edge only
- add/remove affected nodes only
- rebuild only the affected subgraph when practical

Bad pattern:

- “something changed, rebuild the entire engine”

### 6. Use `OfflineAudioContext` for export and analysis workflows

Offline rendering must use an explicit offline path.

Offline flows should:

- recreate the necessary graph deterministically
- apply project truth intentionally
- run without UI timing assumptions
- avoid piggybacking on live playback state

Do not use the live engine as your export engine.

---

## Fast path vs slow path

### Fast path

Use for:

- parameter changes
- transport state nudges
- automation value application
- meter snapshot reads
- sample-accurate runtime control

Requirements:

- minimal overhead
- no graph rebuild
- no heavy object churn
- no cross-layer leakage

### Slow path

Use for:

- graph rebuilds
- topology diffs
- routing changes
- device/plugin insertion or removal
- transport reset-level changes
- offline render preparation

Requirements:

- explicit orchestration
- clear synchronization boundaries
- no accidental triggering on hot user gestures unless intentionally coalesced

---

## Real-time safety rules

### Never do this on RT-adjacent paths

Do not:

- allocate unpredictably
- acquire locks
- perform DOM work
- perform React state updates
- perform filesystem/network I/O
- call Tauri commands
- parse JSON
- log excessively
- create/destroy arbitrary runtime objects in hot loops

### Worklet isolation rules

Worklets must be isolated from:

- React
- presentation code
- domain stores
- Tauri APIs
- arbitrary helper singletons
- non-worklet-safe shared utilities

Treat worklet code as RT-sensitive code, not general app code.

### Scheduling rules

The engine should schedule with a clear look-ahead model or equivalent deterministic transport strategy.

Do not make audio correctness depend on:

- React render cadence
- component mount order
- browser animation frame timing
- view visibility

---

## What belongs where

### Belongs in engine/runtime code

- transport execution
- scheduling windows
- graph ownership
- worklet lifecycle
- routing execution
- bus topology
- metering taps
- latency compensation runtime application
- playback position execution
- offline rendering

### Belongs outside the engine

- UI layout and editor state
- selection
- project-level ownership rules
- save/load workflows
- command parsing
- AI intent interpretation
- non-runtime validation
- view presentation formatting

---

## Latency and transport guidance

### Latency compensation is an engine concern informed by project truth

Compensation values may be derived from project/plugin/routing truth, but applying them to live playback is an engine/runtime responsibility.

### Transport must be engine-owned

The UI should never become the source of truth for:

- playback phase
- playhead progression
- loop execution
- scheduling boundaries

It may display transport summaries and request transport changes.

---

## Anti-patterns

### 1. Engine in React state

Wrong:

- storing `AudioContext`, `AudioNode`, engine instances, or worklet handles in React state, context, or general stores

Right:

- keep runtime objects engine-owned and expose only controlled APIs and summaries

### 2. Hook-controlled transport truth

Wrong:

- a hook is the real owner of playback state

Right:

- hook sends commands and subscribes to engine summaries

### 3. Parameter change triggers graph rebuild

Wrong:

- moving a fader rebuilds routing or recreates nodes

Right:

- parameter path stays separate from topology path

### 4. Main-thread DSP

Wrong:

- mixing/analyzing/manipulating audio buffers in React hooks or render logic

Right:

- use worklets or engine-owned runtime code

### 5. Ad hoc preview contexts

Wrong:

- create a fresh `AudioContext` for preview, one-shots, quick meters, etc.

Right:

- route previews intentionally through the engine unless a distinct offline context is clearly justified

### 6. Engine becomes business model

Wrong:

- engine decides project semantics or becomes persistence truth

Right:

- engine executes truth projections

### 7. Offline render piggybacks on live state

Wrong:

- export reuses live engine state and assumes current UI/runtime state is canonical

Right:

- offline render reconstructs intentionally

---

## Review checklist

Before accepting audio-engine code, verify:

1. Does the engine own time/routing/playback rather than the UI?
2. Is there one live `AudioContext`?
3. Are custom processors in `AudioWorklet`?
4. Are parameter updates separated from topology updates?
5. Does the engine consume truth rather than become truth?
6. Is reconciliation used rather than blanket rebuilds where practical?
7. Are RT-sensitive paths free of UI/framework/native-bridge leakage?
8. Is offline rendering explicit and deterministic?
9. Did the change reduce or increase runtime leakage into the rest of the app?

---
