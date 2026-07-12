---
name: web-audio-engine
description: >-
  Architect browser-side audio as a real-time-safe runtime executor over one
  AudioContext. ALWAYS apply when touching transport timing, clip scheduling,
  routing or buses, automation, worklet processors, metering taps, offline
  rendering, or any low-latency audio path — even if it looks like a small
  parameter tweak or a UI hook reading a meter. Do not store AudioContext/node/
  worklet handles in React state, mix or schedule audio on the main thread, or
  rebuild the graph on a parameter change. Skip non-audio UI, project-state and
  persistence design, AI intent parsing, and native/Tauri concerns.
---

## Purpose

The engine is the runtime executor for playback and processing — owner of live timing, graph topology, and worklet lifecycle — and a derived projection of authoritative project state. It is not a UI concern, a global state bucket, or a second source of truth. Drift into React-held handles, main-thread mixing, or rebuild-on-fader is how audio glitches and becomes unreason-able.

## Core rules

### 1. Use one live `AudioContext`

Root the live engine in a single `AudioContext` for sources, worklets, buses, automation targets, metering, and monitor output. Do not create separate live contexts for mixer, transport, preview, or meters. Use explicit `OfflineAudioContext` only for offline render/export/analysis.

**Why:** multiple live contexts cannot share a clock or graph; they drift and double-allocate hardware buffers.

### 2. Use `AudioWorklet` for custom real-time DSP

Custom low-latency DSP runs in `AudioWorklet`. Do not use `ScriptProcessorNode`. Keep worklet code isolated from app modules, helpers, and Tauri (**policy / RT review**). Depcruise `worklets-no-*` rules are **error** but **forward-looking** — they match `src/modules/<M>/worklets/**` only; processors under `public/audio/worklets/` are outside those paths today.

**Why:** `ScriptProcessorNode` runs on the main thread; worklets run on the audio render thread and must stay isolated.

### 3. Prefer `AudioParam` for continuous control

When a value can be driven with `AudioParam`, prefer it. Do not simulate sample-accurate control with React state, UI timers, or polling loops.

**Why:** `AudioParam` is scheduled on the audio thread with sample accuracy; main-thread timers cannot be.

### 4. Separate parameter changes from topology changes

- **Fast path** — fader/pan/mute/bypass, automation values, meter reads, transport nudges: no graph rebuild, minimal alloc.
- **Slow path** — add/remove track/bus/device, rewire routing, structure-changing clip replace: explicit orchestration; never on hot gestures.

**Why:** routing a hot parameter gesture through a graph rebuild is the most common engine performance bug.

### 5. Reconcile rather than recreate

Prefer targeted updates: changed parameter only, changed routing edge only, add/remove affected nodes only. Avoid “something changed → rebuild the entire engine”.

**Why:** blanket rebuild tears down live nodes mid-playback and drops expensive runtime state.

### 6. Offline export is a separate, deterministic path

Recreate the necessary graph from project truth intentionally. Do not piggyback on live playback state or UI timing.

**Why:** the live engine carries transient runtime state; reusing it makes exports non-deterministic.

### 7. Real-time safety on RT-adjacent paths

Never on RT-adjacent paths: unbounded allocation, locks, DOM/React updates, filesystem/network I/O, Tauri commands, JSON parse, noisy logging, create/destroy churn in hot loops. Schedule with look-ahead (or equivalent); do not bind audio correctness to React render, mount order, rAF, or visibility.

**Why:** a missed audio deadline is an audible dropout; UI timing is best-effort and pausable.

### 8. Ownership: engine executes; project truth decides

Engine owns: live graph, schedule windows, playhead execution, meter accumulators.

Latency-compensation values may come from project/plugin/routing truth; applying them to live playback is engine/runtime work.

Project truth owns: tracks, clips, routing defs, saved params, tempo map, markers.

UI may display summaries and request changes via commands — never owns playback phase, playhead progression, loop execution, or scheduling boundaries. Presentation must not import engine/runtime (`presentation-no-engine-runtime-imports`). React stays in presentation (`react-only-in-presentation`).

**Why:** conflating runtime handles with project meaning makes save/load and collaboration impossible.

## What does not belong

- UI layout, selection, and editor chrome.
- Project-level ownership rules, save/load, command parsing, AI intent.
- Non-runtime validation and view formatting.
- Native plugin host isolation mechanics beyond shared RT rules.

## Anti-patterns

### CRITICAL — Runtime handles in React/stores

❌ Wrong: store `AudioContext`, `AudioNode`, engine instances, or worklet handles in React state, context, or general stores.

✅ Correct: engine-owned runtime objects; expose controlled APIs and summaries only.

### CRITICAL — RT-unsafe work on the audio path

❌ Wrong: allocate, lock, touch DOM/React, FS/network, Tauri, or parse JSON on RT-adjacent paths.

✅ Correct: worklets + prepared schedules; slow path for topology.

### CRITICAL — Parameter gesture rebuilds graph

❌ Wrong: moving a fader rebuilds routing or recreates nodes.

✅ Correct: fast parameter path vs slow topology path (rule 4).

### HIGH — Hook owns playback phase

❌ Wrong: a hook is the real owner of playhead/transport execution.

✅ Correct: hook sends commands and subscribes to engine summaries.

### HIGH — Export reuses live engine state

❌ Wrong: offline render assumes current UI/runtime state is canonical.

✅ Correct: offline path reconstructs the graph from project truth.

### MEDIUM — Extra live AudioContext for preview

❌ Wrong: fresh context for one-shots or meters.

✅ Correct: route previews through the single live engine (or explicit offline context).

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — where `engine/` sits in a module.
- `.dependency-cruiser.cjs` — `worklets-*`, `presentation-no-engine-runtime-imports`, `react-only-in-presentation`.
