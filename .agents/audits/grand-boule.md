# Audit: Grand Boule Plugin

## Goal

A robust, performant, polyphonic physical-modeling piano plugin that handles MIDI input precisely, remains stable under heavy DSP load or 100% voice usage, scales correctly to multiple tracks without state collision, gracefully adapts CPU usage to system limits, and correctly implements the Sourdaw panic/kill workflow.

## Current state

The Grand Boule engine uses a split architecture: a React UI (`GrandBoulePanel.tsx`), a WASM-compiled physical modeling engine in Rust (`engine.rs`, `voice.rs`), a dedicated Web Worker to run the WASM (`grandBouleEngineWorker.ts`), and an AudioWorklet (`grandBouleProcessor.ts`) acting as a consumer via a SharedArrayBuffer (SAB) ring buffer.

Currently, the engine works for single-instance usage but is fatally flawed for prolonged usage or multi-track scaling:
- The UI state relies on a singleton store (`grandBouleStore.ts`).
- The ring buffer reader/writer heads are typed as `Int32Array` and grow monotonically without bounds (`grandBouleEngineWorker.ts`, `GrandBouleProcessor.ts`).
- The Web Worker employs a spin-loop that consumes 100% of a CPU core while waiting for the AudioWorklet to consume the buffer (`grandBouleEngineWorker.ts`).
- The voice simplification logic relies on an ADSR multiplier that never drops while notes are sustained (`voice.rs`).
- The Panic function does not immediately kill the voices (`engine.rs`).

## Findings

1. **Singleton State Collision**: The plugin relies on a module-level singleton store (`grandBouleStore.ts`) rather than a per-instance or per-track state abstraction. This prevents the DAW from supporting multiple independent Grand Boule instances.
2. **Infinite Spin-looping**: The strategy to yield execution back to the event loop inside the Worker uses a `MessageChannel` macrotask with zero delay, effectively creating a 100% CPU spin-loop when the SAB is full.
3. **Numeric Bounds Neglect**: Variables expected to track continuous, monotonic progression (like sample offsets or playhead counts) lack wrap-around logic, making them unsafe for long-running sessions.
4. **Simplification Logic Misalignment**: The progressive voice simplification in the DSP is bound to the ADSR amplitude envelope rather than the actual string energy, meaning sustained notes bypass the CPU-saving mechanisms entirely.

## Priorities

1. **[Critical] Ring Buffer Integer Overflow** (Crash risk after ~12 hours)
2. **[Critical] Worker CPU Spin Loop** (Battery drain, thermal throttling)
3. **[High] Singleton Store Architecture** (Cross-talk on multiple tracks)
4. **[High] Progressive Simplification Defeated by Sustain** (CPU exhaustion)
5. **[Medium] Panic Button Ineffective** (Fails the Sourdaw panic contract)
6. **[Medium] Global MIDI Event Leak in UI** (UI reacts to other tracks' input)

## Issues

### 1. Ring Buffer Integer Overflow
The `writeHead` and `readHead` pointers in the `SharedArrayBuffer` (`grandBouleEngineWorker.ts` and `GrandBouleProcessor.ts`) are stored in an `Int32Array` and increment unconditionally by the block size (128) every render tick. At a 48kHz sample rate, `writeHead` will overflow `2^31 - 1` in ~12.4 hours. When it overflows, it becomes negative, breaking modulo logic (`offset = writeHead % ringFrames`) in JS, throwing out-of-bounds errors in `Float32Array.set()`, and crashing both the Worker and the Worklet.
**Needed:** Cast pointers to unsigned before modulo operations (`(writeHead >>> 0) % ringFrames`) and use wrapping arithmetic for `buffered` checks `(writeHead - readHead) | 0`, or safely wrap the indices back to zero when reaching a safe multiple of `ringFrames`.

### 2. Worker CPU Spin Loop
In `grandBouleEngineWorker.ts`, when the ring buffer reaches `TARGET_AHEAD` (full), the loop breaks and calls `scheduleRender()`. This posts a message to `yieldChannel`, which queues a macrotask that executes immediately, resulting in the Worker thread spinning at 100% CPU doing nothing while waiting for the Worklet to consume frames.
**Needed:** Replace the immediate `yieldChannel` post with a short sleep (e.g., `setTimeout(scheduleRender, 2)`) when the buffer is full, to yield the thread and avoid pegging the CPU.

### 3. Global Singleton Store for Device State
`src/modules/GrandBoule/stores/grandBouleStore.ts` creates a global singleton store. In `GrandBoulePanel.tsx`, this single store is read and mutated. If a user adds two Grand Boule tracks to their arrangement, mutating parameters or pedals on one will mutate the state for the other, causing unpredictable UI cross-talk.
**Needed:** Refactor Grand Boule state to be per-instance (e.g., passing a specific store instance down, or storing the parameter state within the Arrangement track's `device` tree directly).

### 4. Progressive Simplification Defeated by Sustain
In `crates/daw-dsp/src/grand_boule/voice.rs`, progressive simplification downgrades `VoiceQuality` based on `self.amplitude < 0.3`. However, `self.amplitude` is the ADSR release envelope, which remains exactly `1.0` as long as a key is held or the sustain pedal is depressed. Therefore, a chord held with the sustain pedal will never be simplified, causing high CPU usage long after the string energy has dissipated.
**Needed:** Base the simplification threshold on the actual string output envelope, energy level, or voice age, rather than the static ADSR amplitude.

### 5. Panic Button Ineffective
In `crates/daw-dsp/src/grand_boule/engine.rs`, `all_notes_off()` calls `voice.note_off()`. This transitions the voices to the `Releasing` stage, fading them out over ~300ms. A DAW Panic function is expected to kill sound instantaneously.
**Needed:** Modify `all_notes_off()` in `engine.rs` to call `voice.kill()` to immediately zero out the DSP state.

### 6. Global MIDI Event Leak in UI
`GrandBoulePanel.tsx` listens globally to `onMidiNoteOn`, `onMidiNoteOff`, and `onMidiPedalCc` via the event bus. It does not verify if the MIDI event is destined for its specific `deviceId` or track. Playing an unrelated MIDI track will cause the Grand Boule UI keys to light up and its pedals to move.
**Needed:** Filter incoming MIDI events in the UI by track ID or device ID, ensuring the UI only reacts to input routed to its instance.

### 7. Unsafe Disconnect
In `GrandBouleNode.ts`, the `disconnect()` and `destroy()` methods wrap `node.disconnect()` in a generic empty `catch {}` block. This obscures potential routing errors or issues during AudioWorklet lifecycle teardown.
**Needed:** Remove the empty catch block or log the error safely.

## Risks
- **Instability & Crashing:** Leaving the ring buffer issue unaddressed guarantees a hard crash of the audio engine after several hours of continuous use (e.g., leaving the DAW open overnight).
- **Thermal Throttling & Battery Drain:** The Worker spin-loop guarantees the host machine will run hot, draining laptop batteries rapidly and leaving fewer CPU cycles for the main UI thread and other audio processes.
- **Architectural Debt:** The singleton store makes it impossible to build a multi-track song relying on Grand Boule.

## Suggested approaches
- **Integer overflow:** Adopt bitwise unsigned shifting `>>> 0` in JS to treat `Atomics.load` values as `Uint32` rather than signed `Int32`, preventing negative offsets. Alternatively, wrap the head pointers exactly at `ringFrames * MAX_SAFE_MULTIPLE` using a CAS loop.
- **CPU Spin Loop:** Inside `renderLoop`, check if `buffered >= TARGET_AHEAD`. If true, `setTimeout(scheduleRender, 2)` instead of using the `MessageChannel` port, giving the CPU a 2ms rest. If false (buffer needs filling), continue using `yieldChannel` for zero-latency yielding.
- **State management:** Migrate `grandBouleStore` to a map of stores keyed by `deviceId`, or migrate the UI to read from `track.devices[i].parameterValues` using a selector.

## Resolved
*(None yet)*