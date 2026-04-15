# Audit: Grand Boule Plugin

## Goal

A robust, performant, polyphonic physical-modeling piano plugin that handles MIDI input precisely, remains stable under heavy DSP load or 100% voice usage, scales correctly to multiple tracks without state collision, gracefully adapts CPU usage to system limits, and correctly implements the Sourdaw panic/kill workflow.

## Current state

The Grand Boule engine uses a split architecture: a React UI (`GrandBoulePanel.tsx`), a WASM-compiled physical modeling engine in Rust (`engine.rs`, `voice.rs`), a dedicated Web Worker to run the WASM (`grandBouleEngineWorker.ts`), and an AudioWorklet (`grandBouleProcessor.ts`) acting as a consumer via a SharedArrayBuffer (SAB) ring buffer.

Currently, the engine works for single-instance usage but is fatally flawed for prolonged usage or multi-track scaling. It suffers from integer overflows, infinite CPU spin-loops, memory leaks from recreating WebGL contexts, inverted voice-stealing logic, and numerous disconnected UI parameters that give the illusion of control while doing nothing to the audio engine.

## Findings

1. **Singleton State Collision**: The plugin relies on a module-level singleton store (`grandBouleStore.ts`) rather than a per-instance or per-track state abstraction. This prevents the DAW from supporting multiple independent Grand Boule instances.
2. **Infinite Spin-looping**: The strategy to yield execution back to the event loop inside the Worker uses a `MessageChannel` macrotask with zero delay, effectively creating a 100% CPU spin-loop when the SAB is full.
3. **Numeric Bounds Neglect**: Variables expected to track continuous, monotonic progression (like sample offsets or playhead counts) lack wrap-around logic, making them unsafe for long-running sessions.
4. **Simplification Logic Misalignment**: The progressive voice simplification in the DSP is bound to the ADSR amplitude envelope rather than the actual string energy, meaning sustained notes bypass the CPU-saving mechanisms entirely.
5. **Per-Note Parameters Disconnected**: The `setGrandBoulePerNoteParam` use case sends parameters prefixed with `perNote.${key}.${param}`, but the Rust `engine.rs` parameter handler completely ignores this pattern, leaving the entire per-note editing feature functionally dead in DSP.
6. **Missing Parameter Mappings (Placebo Knobs)**: Several global parameters (`stretchAmount`, `attackBite`, `velocityCurve`) are sent to the Web Worker in `camelCase`, but the Worker's `PARAM_MAP` lacks translations for them. It passes them to Rust as `camelCase`, where `engine.rs` expects `snake_case`, dropping them into the default ignore block.
7. **Inverted Voice Stealing Logic**: The DSP engine's `steal_score` calculation heavily prefers stealing newly-released notes over older ones because it subtracts `age_seconds` instead of adding it. It also treats all active notes as equally eligible for stealing because it relies on the static ADSR amplitude rather than string energy.
8. **MIDI Calibration Ignore**: The MIDI calibration panel (`velocityFloor`, `velocityCeiling`, `velocityCurveExponent`, `ccSmoothingMs`, etc) edits `liveState.midiCalibration` but these values are NEVER used. `messageHandlers.ts` bypasses the calibration completely for live MIDI input. The React UI keyboard uses `triggerGrandBouleNote.ts` which uses `state.parameters.velocityCurve` instead of `state.midiCalibration.velocityCurveExponent`. The entire calibration system is effectively a disconnected UI stub.
9. **WebGL Context and Memory Leak in React**: `PianoModel3D.tsx` places the WebGL initialization, program compilation, and `requestAnimationFrame` loop inside a `useEffect` that depends on `activeNotes` (a new `Map` on every key press). This destroys and recreates the entire WebGL context and buffers on every single MIDI event.
10. **60fps React Main-Thread Re-rendering**: The `SpectralWaterfall` receives `fftFrame` as a prop from a state variable in `GrandBoulePanel.tsx`. The parent uses `requestAnimationFrame` to `setFftFrame` 60 times a second, forcing the massive `GrandBoulePanel` tree to undergo React diffing continuously.

## Priorities

1. **[Critical] Ring Buffer Integer Overflow** (Crash risk after ~12 hours)
2. **[Critical] WebGL Context & Memory Leak** (Crash risk within minutes of active playing)
3. **[Critical] Worker CPU Spin Loop** (Battery drain, thermal throttling)
4. **[High] 60fps React Main-Thread Re-rendering** (Severe UI jank and CPU usage)
5. **[High] Missing Parameter Mappings & Per-Note Disconnect** (Major broken features / placebo UI)
6. **[High] Inverted Voice Stealing Logic** (Acoustic glitches and unnatural cutoffs)
7. **[High] Singleton Store Architecture** (Cross-talk on multiple tracks)
8. **[High] Progressive Simplification Defeated by Sustain** (CPU exhaustion)
9. **[Medium] Panic Button Ineffective** (Fails the Sourdaw panic contract)
10. **[Medium] Global MIDI Event Leak & Calibration Bypass** (UI reacts to other tracks' input, calibration does nothing)

## Issues

### 1. Ring Buffer Integer Overflow
The `writeHead` and `readHead` pointers in the `SharedArrayBuffer` (`grandBouleEngineWorker.ts` and `GrandBouleProcessor.ts`) are stored in an `Int32Array` and increment unconditionally by the block size (128) every render tick. At a 48kHz sample rate, `writeHead` will overflow `2^31 - 1` in ~12.4 hours. When it overflows, it becomes negative, breaking modulo logic (`offset = writeHead % ringFrames`) in JS, throwing out-of-bounds errors in `Float32Array.set()`, and crashing both the Worker and the Worklet.
**Needed:** Cast pointers to unsigned before modulo operations (`(writeHead >>> 0) % ringFrames`) and use wrapping arithmetic for `buffered` checks `(writeHead - readHead) | 0`, or safely wrap the indices back to zero when reaching a safe multiple of `ringFrames`.

### 2. WebGL Context & Memory Leak on MIDI Events
In `PianoModel3D.tsx`, the `useEffect` that creates the WebGL context, compiles shaders, and establishes VBOs depends on `[activeNotes, sustainPedal]`. `activeNotes` is a new `Map` object generated on every note on/off. This repeatedly tears down the WebGL canvas (without properly destroying old programs) and recreates it. Browsers cap active WebGL contexts (~8-16), so this crashes the page quickly when playing chords.
**Needed:** Move the WebGL initialization out of the reactive dependency cycle (run it once on mount `[]`), and pass `activeNotes` to the `requestAnimationFrame` render loop via a mutable `useRef`.

### 3. Worker CPU Spin Loop
In `grandBouleEngineWorker.ts`, when the ring buffer reaches `TARGET_AHEAD` (full), the loop breaks and calls `scheduleRender()`. This posts a message to `yieldChannel`, which queues a macrotask that executes immediately, resulting in the Worker thread spinning at 100% CPU doing nothing while waiting for the Worklet to consume frames.
**Needed:** Replace the immediate `yieldChannel` post with a short sleep (e.g., `setTimeout(scheduleRender, 2)`) when the buffer is full, to yield the thread and avoid pegging the CPU.

### 4. 60fps React Main-Thread Re-rendering
In `GrandBoulePanel.tsx`, an analyser node is polled using `requestAnimationFrame`, calling `setFftFrame(new Float32Array(...))` 60 times per second. This `fftFrame` is passed to `SpectralWaterfall`. As a result, the entire `GrandBoulePanel` re-renders at 60fps, generating massive garbage collection pressure and layout thrashing.
**Needed:** Move the `requestAnimationFrame` loop and `AnalyserNode` polling entirely inside `SpectralWaterfall.tsx`, keeping `fftFrame` out of React state, or use a mutable ref instead of state to coordinate.

### 5. Missing Parameter Mappings & Per-Note Disconnect
In `setGrandBoulePerNoteParam.ts`, parameter overrides are dispatched to the engine via `name: "perNote.${key}.${param}"`. However, `engine.rs` has no string matching logic for `perNote.*`. Additionally, `stretchAmount`, `attackBite`, and `velocityCurve` are sent to the Web Worker in `camelCase`. Since they are missing from the Worker's `PARAM_MAP`, they are passed to Rust exactly as `camelCase`. `engine.rs` explicitly expects `snake_case` (e.g. `"stretch_amount"`), causing all of these parameters to be ignored.
**Needed:** Add the missing translations to `PARAM_MAP` in `grandBouleEngineWorker.ts`. Add string parsing in `engine.rs`'s `set_param` to match `"perNote."`, extract the key and parameter name, and update a new per-note override structure.

### 6. Inverted Voice Stealing Logic
In `crates/daw-dsp/src/grand_boule/voice.rs`, `steal_score` subtracts `age_seconds` for releasing notes (`400.0 - age_seconds`), making older notes score lower than fresh ones. It also subtracts `amplitude` for active notes, but `amplitude` is always `1.0` during the `Active` stage, meaning all active notes have a score of `0.0` regardless of acoustic energy. As a result, the engine steals the loudest, most recently played notes first.
**Needed:** Invert the age logic (`400.0 + age_seconds`) so older releasing notes score higher. For active notes, calculate the score based on the actual tracked string energy (e.g. `self.last_string_displacement.abs()`) instead of the static ADSR `amplitude`.

### 7. Global Singleton Store for Device State
`src/modules/GrandBoule/stores/grandBouleStore.ts` creates a global singleton store. In `GrandBoulePanel.tsx`, this single store is read and mutated. If a user adds two Grand Boule tracks to their arrangement, mutating parameters or pedals on one will mutate the state for the other, causing unpredictable UI cross-talk.
**Needed:** Refactor Grand Boule state to be per-instance (e.g., passing a specific store instance down, or storing the parameter state within the Arrangement track's `device` tree directly).

### 8. Progressive Simplification Defeated by Sustain
In `crates/daw-dsp/src/grand_boule/voice.rs`, progressive simplification downgrades `VoiceQuality` based on `self.amplitude < 0.3`. However, `self.amplitude` is the ADSR release envelope, which remains exactly `1.0` as long as a key is held or the sustain pedal is depressed. Therefore, a chord held with the sustain pedal will never be simplified, causing high CPU usage long after the string energy has dissipated.
**Needed:** Base the simplification threshold on the actual string output envelope, energy level, or voice age, rather than the static ADSR amplitude.

### 9. Panic Button Ineffective
In `crates/daw-dsp/src/grand_boule/engine.rs`, `all_notes_off()` calls `voice.note_off()`. This transitions the voices to the `Releasing` stage, fading them out over ~300ms. A DAW Panic function is expected to kill sound instantaneously.
**Needed:** Modify `all_notes_off()` in `engine.rs` to call `voice.kill()` to immediately zero out the DSP state.

### 10. Global MIDI Event Leak & Calibration Bypass
`GrandBoulePanel.tsx` listens globally to `onMidiNoteOn`, `onMidiNoteOff`, and `onMidiPedalCc` via the event bus. It does not verify if the MIDI event is destined for its specific `deviceId` or track. Furthermore, the `MidiCalibrationPanel` settings are entirely bypassed by the actual audio engine routing in `messageHandlers.ts`, which sends raw `velocity / 127` instead.
**Needed:** Filter incoming MIDI events in the UI by track ID or device ID. Apply `midiCalibration` parameters to incoming MIDI velocities in `messageHandlers.ts` using the provided `applyVelocityCurve` utility, and synchronize the UI to read from this central calibration state rather than duplicating a distinct `velocityCurve` parameter.

### 11. Unsafe Disconnect
In `GrandBouleNode.ts`, the `disconnect()` and `destroy()` methods wrap `node.disconnect()` in a generic empty `catch {}` block. This obscures potential routing errors or issues during AudioWorklet lifecycle teardown.
**Needed:** Remove the empty catch block or log the error safely.

## Risks
- **Browser/DAW Crash:** The WebGL context leak will crash the entire DAW UI within minutes of playing chords.
- **Engine Crash:** The ring buffer issue guarantees a hard crash of the audio engine after ~12 hours of continuous use.
- **Thermal Throttling & UI Jank:** The Worker spin-loop and the 60fps React render loop will heavily tax the CPU, causing UI stutter and degrading real-time audio performance.
- **Feature Illusion & Audio Glitches:** Several parameters are placebo knobs, and the inverted voice stealing guarantees abrupt, unnatural cutoffs during dense passages, severely undermining the product's acoustic quality.

## Suggested approaches
- **Integer overflow:** Adopt bitwise unsigned shifting `>>> 0` in JS to treat `Atomics.load` values as `Uint32` rather than signed `Int32`.
- **CPU Spin Loop:** Inside `renderLoop`, check if `buffered >= TARGET_AHEAD`. If true, `setTimeout(scheduleRender, 2)` instead of using the `MessageChannel` port.
- **React Performance (WebGL & Waterfall):** 
  - For `PianoModel3D`: Store `activeNotes` in a `useRef` and access it from within a stable `requestAnimationFrame` loop instantiated exactly once on mount.
  - For `SpectralWaterfall`: Move the `engine.getAnalyserNode()` subscription logic inside the component itself, updating its canvas directly within its own `requestAnimationFrame` loop to bypass React's render cycle completely.
- **Missing Parameters & Voice Stealing:** Update `PARAM_MAP` in the Worker to correctly translate `stretchAmount` and `attackBite`. Rewrite `steal_score` in Rust to add `age_seconds` and rely on string energy `transverse_sample` rather than ADSR state.
- **Per-Note DSP Integration:** Pass a structured array or map of overrides from the Web Worker to the Rust engine on every change, and have the engine merge these into its calculation for `note_on`.
- **State management:** Migrate `grandBouleStore` to a map of stores keyed by `deviceId`.

## Resolved
*(None yet)*