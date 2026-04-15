# Levain Plugin End-to-End Audit

## Goal
Levain is the core sample playback and performance intelligence engine for Sourdaw, designed to emulate realistic orchestral sections and soloists. "Good" means:
- Seamless articulation switching and expression (CC1 dynamics, CC11 expression, vibrato).
- Intelligent performance simulation (legato, auto-divisi, ensemble timing, humanization).
- Multi-track independence (each track must have its own state, engine instance, and patch data).
- High-performance Rust audio processing without blocking the main thread or dropping voices.
- Intuitive, tactile macro controls in the UI perfectly synced with the engine.

## Current State
Levain has a robust DSP engine (`crates/daw-dsp/src/levain`) capable of complex humanization, legato, and mic mixing. However, the JS/UI layer currently forces it into a singleton pattern. `levainStore` acts as a global store. `levainBridge` tracks a single `activeDevice` and flushes parameters globally, causing multi-track orchestration to be completely broken. Furthermore, several critical features (macros, transition zones, Tone/Attack/Release) are mocked or hard-coded in the Rust engine.

## Priorities
1. **Critical:** Fix the singleton architecture (`levainStore` and `levainBridge` must be per-instance/device-scoped).
2. **High:** Decouple `levainBridge` from the Arrangement domain (`getAllTracks`).
3. **High:** Wire up the missing macro parameters (`Tone`, `Attack`, `Release`) in the Rust engine.
4. **Medium:** Implement the true legato transition zone lookup in `engine.rs`.
5. **Medium:** Fix the global `LevainLoadingSpinner` logic.

## Findings
- **Singleton Pattern in a Multi-Instance Context:** `levainStore` initializes with one `defaultLevainState`. `LevainPanel` hooks into this global store. This implies you can only view or edit one Levain instance across the entire project at a time.
- **Domain Leakage:** `levainBridge` imports `getAllTracks` from the Arrangement module to find an active Levain device. Plugins should be agnostic of the DAW's track list (architectural violation).
- **Incomplete Engine Integrations:** The UI provides 8 macros, but the engine explicitly drops three of them (`Tone`, `Attack`, `Release`).
- **Deferred Features:** The legato engine lacks the final lookup for transition samples (`TrueTransition`), falling back to a crossfaded sustain zone.

## Issues

### 1) Critical Bugs
**Singleton Store / Multi-track breakage**
- **Severity:** Critical
- **Evidence:** `src/modules/Levain/stores/levainStore.ts` exports a single `levainStore`. `src/modules/Levain/useCases/levainParamBridge/helpers.ts` uses a global `activeDevice` and loop over `getAllTracks()` to find it.
- **Files involved:** `levainStore.ts`, `helpers.ts`, `LevainPanel.tsx`.
- **Why it matters:** Users cannot use more than one Levain instrument in a project without them stomping on each other's state and UI.
- **Needed:** Convert `levainStore` to a factory function or map indexed by `deviceId`. Update `LevainPanel` to accept a `deviceId` prop and subscribe to the correct store instance. `levainBridge` must manage instances keyed by `deviceId`.

### 2) Functional Issues
**Tone, Attack, and Release macros do nothing**
- **Severity:** High
- **Evidence:** In `crates/daw-dsp/src/levain/engine.rs` (lines 343-347): `"tone" => {}`, `"attack" | "release" => {}`.
- **Files involved:** `crates/daw-dsp/src/levain/engine.rs`
- **Why it matters:** The user manipulates the Tone/Attack/Release knobs in the UI and hears no difference.
- **Needed:** Implement simple ADSR overrides and a tilt-EQ/filter in the `LevainEngine` and apply them to the voices in `process_block`.

**Missing True Legato Transition Samples**
- **Severity:** Medium
- **Evidence:** `engine.rs` (line 182) has a `TODO: when transition sample zones are populated, look up the transition zone by sample_id and play that instead of the sustain zone.`
- **Files involved:** `crates/daw-dsp/src/levain/engine.rs`
- **Why it matters:** Orchestral libraries rely heavily on true legato intervals. Without this, legato is merely an overlapped crossfade.
- **Needed:** Finish the transition zone lookup logic in `LegatoResult::TrueTransition`.

### 3) UX/UI Issues
**Global Loading Spinner**
- **Severity:** Medium
- **Evidence:** `LevainLoadingSpinner.tsx` checks if the track has a levain device, but then uses the global `levainState.sampleLoadProgress`.
- **Files involved:** `src/modules/Arrangement/presentations/views/TrackHeader/LevainLoadingSpinner.tsx`
- **Why it matters:** If Track 2 is loading Levain, Track 1 (which also has Levain) will show a loading spinner too, leading to user confusion.
- **Needed:** Scope `sampleLoadProgress` to `deviceId`.

### 4) Structural/Code Health Issues
**Bridge couples Plugin to Arrangement Domain**
- **Severity:** High
- **Evidence:** `levainBridgeDependencies.ts` imports `getAllTracks` from `#/modules/Arrangement/useCases`.
- **Files involved:** `src/modules/Levain/useCases/levainParamBridge/levainBridgeDependencies.ts`, `helpers.ts`
- **Why it matters:** This violates module boundaries. A device plugin should not depend on the track arrangement state.
- **Needed:** Inject the `deviceId` directly when initializing the bridge or panel, rather than scanning the entire arrangement to find a matching type.

### 5) Performance Concerns
**WASM Init Error Handling lacks recovery**
- **Severity:** Low
- **Evidence:** `LevainNode.ts` logs a warning if `e.data?.type === 'error'` but does not recover.
- **Files involved:** `src/modules/AudioEngine/engine/LevainNode.ts`
- **Why it matters:** If the WASM thread crashes, the node stays silent forever.
- **Needed:** Add a mechanism to reboot or mark the node as dead in the UI.

### 6) Security/Stability Risks
*None identified.*

### 7) Missing features or unfinished integrations
**Bypass not wired to UI**
- **Severity:** Low
- **Evidence:** `LevainNode.ts` supports `setBypass` but `LevainPanel.tsx` has no UI control for it.
- **Files involved:** `src/modules/AudioEngine/engine/LevainNode.ts`, `src/modules/Levain/presentations/views/LevainPanel.tsx`
- **Why it matters:** Bypassing an instrument is a fundamental DAW feature.
- **Needed:** Add a power button to `LevainPanel` that maps to the `bypass` state.

### 8) Low-effort/high-impact improvements
**Consolidate Patch State**
- **Severity:** Low
- **Evidence:** `LevainDescriptor` in Arrangement has `hasCustomUI: true` and a few duplicated parameters (e.g., `humanize`, `legatoEnabled`).
- **Files involved:** `src/modules/Arrangement/models/pluginDescriptors/levainDescriptor.ts`
- **Why it matters:** Duplication of state between the plugin descriptor and `LevainPatch`.
- **Needed:** Align the parameters so the host can automate them correctly.

### 9) Recommended refactors
- Refactor `LevainPatch` to be instantiated per plugin instance in the true project state (`Workspace` or `Project` module) instead of living in a transient UI store (`levainStore`), ensuring patches are saved and loaded perfectly.

## Risks
If the singleton architecture is left unaddressed, the entire Sourdaw application will fail when attempting complex orchestral arrangements using multiple Levain tracks. Users will experience severe state corruption across tracks. If the missing Tone/Attack/Release parameters are not implemented, users will consider the plugin broken or incomplete.

## Suggested approaches
1. **Decouple and Parameterize:** Refactor `levainStore` to export a function `getLevainStore(deviceId: string)` that returns or creates a store.
2. **Push State Up:** Store the `LevainPatch` as a serialized blob in the `DeviceParameter` state of the track, so it saves/loads with the project.
3. **Bridge Refactor:** Update `levainBridge` to manage a map of `activePorts` and `activeDevices` by `deviceId`, avoiding `getAllTracks`.
4. **Implement Missing DSP:** Add an ADSR struct to the `Voice` in `engine.rs` to handle attack and release modifications, and a simple 1-pole filter for Tone.
