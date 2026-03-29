# Sourdaw Rust Backend Codebase Audit (2026-03-29)

> **Goal:** Audit the Rust native backend ecosystem against the rules and constraints strictly defined in `docs/daw_backend_architecture.md`.

## Overview

Unlike the TypeScript frontend which suffers from pattern bloat, the Rust backend is suffering from **architectural drift**. The current codebase ignores the foundational decoupling rules stated in the architecture guide, heavily favoring un-typed Tauri bindings and isolated instrument sub-crates over a holistic DAW engine.

---

## P0 — Hard Architectural Boundary Violations

### 1. Workspace Topology Breach (The 5-Crates Rule)

The absolute core tenet of the `daw_backend_architecture.md` is that the DAW should operate exactly within a 5-crate boundary: `daw-core`, `daw-engine`, `daw-dsp`, `daw-plugin-host`, and `daw-io` (with `src-tauri` as a thin wrapper).

**Violation:** The workspace contains **zero** of these crates. Instead, it maintains ad-hoc embedded crates representing specific plugins (`fermenter`, `toaster`, `levain`) and a loose `audio-core` crate, all sitting inside the `src-tauri` folder rather than a clean `/crates/` root. This completely bypasses the data-oriented decoupling that `daw-core` provides, and spreads DSP routing logic across the Tauri bridge layer instead of unifying it into a top-level `daw-engine`.

### 2. Audio Streaming Over JSON IPC (Catastrophic Performance Defect)

The architecture explicitly dictates zero-copy, natively-threaded processing (via `cpal`) or fully synchronous SharedArrayBuffer handling for the web target.

**Violation:** In `src-tauri/src/commands/audio_ipc.rs`, the `audio_ipc` Tauri command is routing 128-frame interleaved floating point arrays natively _through the standard IPC bridge_. The routine decodes a Base64-bound `Vec<u8>`, spawns multi-pass allocations `vec![0.0f32; samples]`, blocks the invocation with a standard mutex `.lock()`, and JSON-encodes an array out. Running this 344 times a second guarantees stuttering, massive garbage collection pressure, and entirely breaks Worklet synchronization constraints.

### 3. Untyped Tauri IPC (No Specta Sync)

The architecture guide specifically demands `#[serde(transparent)]` newtypes (e.g., `PluginId`, `TrackId`) and absolute synchronization via `tauri-specta` to enforce strict DDD typing on both sides of the application.

**Violation:** Almost none of the `#[tauri::command]` functions in the backend use `#[specta::specta]` annotations, and there are no domain newtypes. In `src-tauri/src/commands/plugins.rs`, the API falls back to raw `String` usages for IDs and raw `f64` values. The lack of auto-generated TS bindings completely breaks the "typesync" contract between the frontend and Rust side.

---

## P1 — Real-Time Pipeline Violations

The golden rule of DSP is no allocations or Mutex locking on the audio thread. While no locks were detected inside the DSP paths, heavy allocation mechanisms were found in real-time boundaries.

### 4. Dynamic Resizing in the Processing Hot Path

- **`toaster/src/engine.rs`**: In the primary `process_block` call handling polyphony, the array engine calls `self.bus_buffers.resize(len, 0.0)` for all 8 internal matrices on _every incoming chunk_. Vector reallocation triggers dynamic heap assignments. Crate algorithms must pre-allocate fixed-size buffers sized to `MAX_AUDIO_BLOCK` instead.

### 5. Unbounded Memory Generation

- **`toaster/src/euclidean.rs`**: Dynamically generates rhythm matrices. Functions generate nested dynamically-sized vectors (`Vec<Vec<bool>>`) and array initializations. If this algorithm runs on demand inside the `cpal` realtime callback rather than being pre-calculated strictly on the UI-thread, it is a severe priority-inversion risk.
- **`fermenter/src/voice.rs`**: Single monophonic structural allocations instantiate _every_ underlying DSP submodule unconditionally (`KarplusStrong`, `SamplerEngine`, `AdditiveEngine`, `GranularEngine`). Polyphonic scaling duplicates maximum memory indiscriminately.

---

## P2 — Missing Bridge Integrity

### 6. Absence of the "Compiled Schedule" Engine

The architecture document mandates an `EngineHandle` that owns the track-level connection graph natively, pre-calculates the topology via `petgraph`, and streams a flattened vector (`Vec<ProcessTask>`) into the audio thread via lock-free `rtrb` buffers.

**Violation:** Because there is no `daw-engine` crate, there is no centralized lock-free schedule router. Commands interact directly with isolated components, creating uncoordinated state updates.

### 7. Collision-Prone Polyfills

- **`src-tauri/src/commands/audio_gen.rs`**: A homebrew `uuid_v4` utility formats time nanoseconds into a localized Hex digest instead of employing safe cryptographic standards (`uuid` crate). This guarantees collision faults across rapid concurrent sidecar fetching.

---

## Summary

The Rust codebase needs an immediate re-orchestration. Before further features (like the new Yeast and Scoring modules) are integrated into Rust, the Cargo Workspace must be reorganized into `daw-core`, `daw-engine`, etc., `audio_ipc` must be refactored or deleted, and the IPC bindings must be bound via `tauri-specta`.
