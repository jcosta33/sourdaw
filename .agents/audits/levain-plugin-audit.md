# Levain Plugin End-to-End Audit

## Goal
Levain is Sourdaw's flagship orchestral performance engine. It must provide high-fidelity sample playback, intelligent legato, and "orchestral realism" (physical modeling artifacts) while supporting complex, multi-track arrangements. "Good" means per-instance state isolation, sample-accurate event timing, seamless articulation switching, and a DSP engine that fully realizes the performance gestures (Macros/Expression) initiated in the UI.

## Current State
Levain is functionally impressive in isolation but architecturally "unfinished" for production use. The JS/TS layer is built around a singleton pattern that breaks as soon as a second Levain track is added. The Rust engine has sophisticated frameworks for humanization and legato, but critical parts of these (True Legato transitions, Macro mappings for Tone/Attack/Release) are currently stubs. MIDI timing is currently jittery due to un-timestamped `MessagePort` dispatch.

## Priorities
1. **[CRITICAL]** Fix Singleton Architecture: Move from `levainStore` to per-instance state (indexed by `deviceId`).
2. **[CRITICAL]** Fix Automation Persistence: Ensure `persistDeviceParam` targets the correct `deviceId`, not just the first one found.
3. **[HIGH]** Implement Stubbed DSP: Wire `Tone`, `Attack`, and `Release` macros in the Rust engine.
4. **[HIGH]** Sample-Accurate MIDI: Implement a jitter buffer/scheduler in the Rust engine to handle `sampleFrame` offsets from MIDI events.
5. **[HIGH]** True Legato: Implement the transition sample lookup logic in `engine.rs`.
6. **[MEDIUM]** Randomization Seeds: Unique RNG seeds per instance to prevent deterministic phasing.

## Findings

### 1. Architectural Integrity & Persistence
- **Singleton Violation:** `src/modules/Levain/stores/levainStore.ts` exports a single `levainStore`. Every `LevainPanel` and bridge call currently points to this global object.
- **Automation Corruption:** `levainBridge.ts` resolves `activeDeviceId` by finding the first Levain device in the project (`deps.getAllTracks()`). Parameter changes on *any* instance will overwrite the automation state of the *first* instance.
- **Cross-Module Coupling:** Bridge helpers import `getAllTracks` from the Arrangement module. Plugins must be agnostic of host track layout.

### 2. Audio Engine (Rust DSP)
- **Stubbed Macros:** In `crates/daw-dsp/src/levain/engine.rs`, the `"tone"`, `"attack"`, and `"release"` parameter handlers are empty blocks (`{}`).
- **Legato Implementation Gap:** `engine.rs` contains a `TODO` for `TrueTransition`. It currently falls back to a crossfaded sustain zone rather than playing transition samples.
- **MIDI Jitter:** The `noteOn`/`noteOff` handlers in `engine.rs` process events immediately upon receipt. Since `MessagePort` delivery is not sample-accurate relative to the audio clock, this introduces audible timing jitter.
- **Determinstic Randomization:** The `Humanizer` (humanize.rs) defaults to seed `42`. Multiple instances playing the same MIDI will phase perfectly because their "random" offsets are identical.

### 3. Sample Loading & Memory
- **Sequential Loading:** `loadInstrumentFromManifest.ts` fetches and decodes samples one-by-one. This is unnecessarily slow for large orchestral banks.
- **Memory Pressure:** `SamplePool` stores samples as raw `Vec<f32>` in the WASM heap. Large orchestral sections may exceed the 4GB WASM memory limit without aggressive LOD management.
- **Tauri Path Brittleness:** `autoLoadSamples.ts` relies on the `_up_/public` path convention, which is a fragile deployment detail.

### 4. UI/UX and State
- **Global Spinners:** `LevainLoadingSpinner.tsx` reads from the global `levainStore`. Loading Track 1 causes Track 2 to show a spinner.
- **Hardcoded Labels:** Macro labels are hardcoded in the UI component, making it impossible for custom user patches or future instruments to redefine macro roles.

## Issues

### 1) Critical Bugs
**1.1. Multi-Track State & Persistence Corruption**
- **Severity:** Critical
- **Evidence:** `levainStore.ts` (Singleton) and `helpers.ts` (`activeDeviceId` resolution via `getAllTracks`).
- **Why it matters:** Users cannot use multiple Levain tracks. Parameter tweaks on Track 2 will "leak" into Track 1's automation and UI.
- **Needed:** Scoped stores and bridge instances keyed by `deviceId`.

**1.2. MIDI Timing Jitter**
- **Severity:** High
- **Evidence:** `LevainNode.ts` sends `sampleFrame` but `engine.rs` has no jitter buffer to schedule the event at that offset.
- **Why it matters:** Orchestral music relies on precise micro-timing. Main-thread jitter will degrade the performance feel.
- **Needed:** An event queue in the Rust engine that holds messages until the `current_sample + offset` is reached in `process_block`.

### 2) Functional Issues
**2.1. Tone/Attack/Release Macros are non-functional**
- **Severity:** High
- **Evidence:** `engine.rs` lines 343-347 (Empty blocks).
- **Needed:** Implement a 1-pole filter for Tone and ADSR overrides for Attack/Release in `LevainVoice`.

**2.2. True Legato transitions are missing**
- **Severity:** High
- **Evidence:** `engine.rs` line 182 (`TODO`).
- **Needed:** Complete the `LegatoResult::TrueTransition` branch.

### 3) UX/UI Issues
**3.1. Cross-track Loading Spinners**
- **Severity:** Medium
- **Evidence:** `LevainLoadingSpinner.tsx` uses global `levainState.sampleLoadProgress`.
- **Needed:** Contextual progress tracking.

### 4) Structural/Code Health Issues
**4.1. Architecture Violation (Sandboxing)**
- **Evidence:** `levainBridgeDependencies.ts` imports from `#/modules/Arrangement`.
- **Needed:** Pass `deviceId` during initialization.

### 5) Performance Concerns
**5.1. Sequential Sample Decoding**
- **Severity:** Medium
- **Evidence:** `loadInstrumentFromManifest.ts` loop.
- **Needed:** Parallelize `fetchAndDecode` with a concurrency limit.

## Risks
The current architecture makes Levain a "singleton plugin," which is a fundamental failure for a DAW. Furthermore, the lack of sample-accurate MIDI and stubbed DSP parameters will lead to professional users perceiving the engine as "amateur" or "broken."

## Suggested approaches
1. **Refactor Store:** Convert `levainStore` to a `Map<string, Store<LevainState>>`.
2. **Event Scheduling:** Add a `VecDeque<MidiEvent>` to `LevainEngine` in Rust. In `process_block`, consume events only when their `sample_frame` timestamp is reached.
3. **Instance Seeds:** Pass a unique `u64` seed (e.g., derived from `deviceId`) to the Rust engine on `init`.
4. **DSP Wiring:** Implement a simple Tilt-EQ for `Tone` and modify the `AdsrEnvelope` to accept runtime rate multipliers.

## Verification notes (2026-04-14)

### Pass 2

| Claim | Check |
|--------|--------|
| `"tone"`, `"attack"`, `"release"` no-ops | **Confirmed** — `engine.rs` ~406–410. |
| Default human seed `42` | **Confirmed** — `crates/daw-dsp/src/levain/types.rs` ~385 `seed: 42` in default config. |
| `levainBridgeDependencies` | **Exists** — `src/modules/Levain/useCases/levainParamBridge/levainBridgeDependencies.ts` (path corrected from generic `helpers.ts`). |
| Singleton / first-device bridge | **Refined in Pass 3** — see below. |

### Pass 3 (2026-04-14) — `levainBridge` + `persistDeviceParam`

| Claim | Result |
|--------|--------|
| **Injectable singleton** | **Confirmed** — `levainBridge.ts` uses `inject(levainBridgeDependencies)` and returns one shared `LevainBridgeApi`. |
| **`persistDeviceParam` targets one device id** | **Confirmed** — `helpers.ts` `registerLevainDevice` sets `activeDeviceId` by scanning `getAllTracks()` and taking the **first** track that has `devices.find((dev) => dev.type === 'levain')`, then `break` (~63–71). Multiple Levain instances across tracks → **wrong id** for any but the first matching track order. |
| **`unregisterLevainDevice` clears id** | **Confirmed** — ~92–96 clears `activeDevice` / `activePort` and `paramBatcher.cancelAll()` but does **not** clear `activeDeviceId` (still used if stale — worth fixing with explicit `activeDeviceId = null`). |
