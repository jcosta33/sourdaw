---
name: web-audio-engine
description: >-
    Architect browser-side audio as a real-time-safe runtime executor over one
    AudioContext. ALWAYS apply when touching transport timing, clip scheduling,
    routing or buses, automation, worklet processors, metering taps, offline
    rendering, or any low-latency audio path — even if it looks like a small
    parameter tweak or a UI hook reading a meter. Skip non-audio UI, project-state
    and persistence design, AI intent parsing, and native and desktop-shell concerns.
---

## Purpose

The engine executes playback and processing — live timing, graph topology, worklet lifecycle — as a derived projection of project truth. It is never a second source of truth.

## Core rules

### 1. One live `AudioContext`

Root sources, worklets, buses, automation targets, metering, and monitor output in a single `AudioContext`. Never open a second live context for mixer, transport, preview, or meters. `OfflineAudioContext` is for offline render, export, and analysis only.

**Why:** separate live contexts cannot share a clock or graph; they drift and double-allocate hardware buffers.

### 2. Custom real-time DSP runs in `AudioWorklet`

Never `ScriptProcessorNode`. Worklet code stays isolated from app modules, helpers, and the desktop bridge. The depcruise `worklets-no-*` rules are **error** but match `src/modules/<M>/worklets/**` only; processors under `public/audio/worklets/` fall outside them, so nothing checks those and the isolation there rests on you.

**Why:** `ScriptProcessorNode` runs on the main thread; worklets run on the audio render thread and must stay isolated.

### 3. Continuous control uses `AudioParam`

Where an `AudioParam` can drive the value, use it. Never simulate sample-accurate control with React state, UI timers, or polling loops.

**Why:** `AudioParam` is scheduled on the audio thread with sample accuracy; main-thread timers cannot be.

### 4. Parameter changes are not topology changes

- **Fast path** — fader, pan, mute, bypass, automation values, meter reads, transport nudges: no graph rebuild, minimal alloc.
- **Slow path** — add/remove track, bus, or device, rewire routing, structure-changing clip replace: explicit orchestration, never on a hot gesture.

**Why:** routing a hot parameter gesture through a graph rebuild is the most common engine performance bug.

### 5. Reconcile, never recreate

Update the changed parameter, the changed routing edge, the affected nodes. Never "something changed → rebuild the engine".

**Why:** a blanket rebuild tears down live nodes mid-playback and drops expensive runtime state.

### 6. Offline export is a separate deterministic path

Rebuild the graph from project truth. Never piggyback on live playback state or UI timing.

**Why:** the live engine carries transient runtime state; reusing it makes exports non-deterministic.

### 7. RT-adjacent paths forbid the slow world

Never on an RT-adjacent path: unbounded allocation, locks, DOM/React updates, filesystem/network I/O, desktop bridge calls, JSON parse, noisy logging, create/destroy churn in hot loops. Schedule with look-ahead or equivalent. Never bind audio correctness to React render, mount order, rAF, or visibility.

**Why:** a missed audio deadline is an audible dropout; UI timing is best-effort and pausable.

### 8. Engine executes; project truth decides

- **Engine owns:** live graph, schedule windows, playhead execution, meter accumulators.
- **Project truth owns:** tracks, clips, routing defs, saved params, tempo map, markers.

Latency-compensation values come from project, plugin, or routing truth; applying them to live playback is engine work.

UI displays summaries and requests changes via commands. It never owns playback phase, playhead progression, loop execution, or scheduling boundaries. Presentation must not import engine/runtime (`presentation-no-engine-runtime-imports`); React stays in presentation (`react-only-in-presentation`).

**Why:** conflating runtime handles with project meaning makes save/load and collaboration impossible.

## Out of scope

Native plugin host isolation beyond the shared RT rules — see `plugin-hosting`.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — where `engine/` sits in a module.
- [docs/architecture/01-system.md](../../../docs/architecture/01-system.md) — channels and engine/executor model.
- [src/modules/AudioEngine/AGENTS.md](../../../src/modules/AudioEngine/AGENTS.md) — WASM pipeline and worklet wiring.
- `.dependency-cruiser.cjs` — `worklets-*`, `presentation-no-engine-runtime-imports`, `react-only-in-presentation`.
