# Grinder Plugin End-to-End Audit

## Goal
The Grinder plugin must be a high-performance, real-time safe amp simulator with sample-accurate parameter automation, clean separation of persistent truth from high-frequency telemetry, and an editor UI that does not suffer from massive 60fps re-renders. It must strictly adhere to `web-audio-engine`, `ui-patterns`, and `state-and-write-paths` mandates.

## Findings

The architecture contains severe UI thread performance issues, violations of RT-safe automation rules, and disconnected features where UI state does not reach the audio thread. Additionally, the Rust DSP engine has numerous code quality warnings and missing capabilities.

## Priorities
1. **Critical:** Decouple telemetry from the persistent patch store to fix 60fps full-tree UI re-renders.
2. **Critical:** Expose `AudioParam`s for continuous variables to enable sample-accurate automation.
3. **Critical:** Fix the `replacePatch` event flood on pedal knob drags.
4. **Functional:** Wire up missing parameters (`micBlend`, `roomAmount`, `postPedals`) to the audio engine sync list, and implement their missing logic in the Rust engine.
5. **Structural:** Clean up all Cargo warnings/clippy lints in the `daw-dsp` crate to ensure a healthy compilation baseline.
6. **UX:** Make the cabinet mic positions interactive.

---

### 1) Critical Bugs

#### [CRITICAL] 1.1 Persistence Flood on Drive Knobs
**Severity:** Critical
**Evidence:** `src/modules/Grinder/presentations/views/GrinderPanel.tsx` (`DriveDeck`) and `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
**Why it matters:** In the Drive tab, adjusting any continuous pedal parameter calls `replacePatch`, which delegates to `loadGrinderPatchWithAudio`. This function triggers a sync and persistence call (`persistDeviceParamFn`) for *all 52+ parameters* in the patch. Rotating a single drive knob fires 52 synchronous persistence calls per tick, destroying performance, flooding IPC/bridge channels, and polluting the undo history with massive state objects instead of single property diffs.
**Concrete Fix:** 
- Do not use `replacePatch` for continuous knob updates.
- Create a specific updater `setGrinderPedalParamWithAudio` that updates only the targeted pedal parameter and routes it through `paramBatcher` exactly like `setGrinderParamWithAudio`.

---

### 2) Functional Issues

#### [FUNC] 2.1 Lack of Sample-Accurate Automation (`AudioParam`)
**Severity:** High
**Evidence:** `src/modules/AudioEngine/engine/GrinderNode.ts` and `src/modules/AudioEngine/services/grinderProcessor.ts`
**Why it matters:** All parameter changes—including continuous ones like gain, EQ, and master volume—are sent to the audio worklet via `postMessage({ type: 'param', ... })`. This explicitly violates the `web-audio-engine` mandate: *"Use `AudioParam` whenever possible... Do not simulate sample-accurate control with React state, UI timers, or arbitrary polling loops."* It renders sample-accurate automation from timeline tracks impossible.
**Concrete Fix:** 
- Expose continuous controls (Gain, Bass, Mid, Treble, Master, Output) as `AudioParam`s in `GrinderProcessor.parameterDescriptors`.
- Connect the host `Automation` curves directly to these `AudioParam`s.
- Keep `postMessage` only for discrete/topology changes (e.g., `ampModel`, `engineMode`, `cabEnabled`).

#### [FUNC] 2.2 Missing Audio Sync for Key Parameters
**Severity:** High
**Evidence:** `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
**Why it matters:** The parameters `micBlend`, `roomAmount`, and the entire `postPedals` array exist in the `GrinderPatch` model and the UI, but they are absent from `AUDIO_SYNC_KEYS` and the sync logic. Adjusting them in the UI has zero effect on the audio engine. They are visually present but functionally dead.
**Concrete Fix:** 
- Add `micBlend` and `roomAmount` to `AUDIO_SYNC_KEYS`.
- Implement `syncSupportedPostPedals` analogous to `syncSupportedPedals` for the `postPedals` array, and make sure `PARAM_MAP` in `grinderProcessor.ts` supports them.

---

### 3) UX/UI Issues

#### [UX] 3.1 Uneditable Cabinet Mic Positions
**Severity:** Medium
**Evidence:** `src/modules/Grinder/presentations/views/GrinderPanel.tsx` (`CabStage`)
**Why it matters:** The Cab UI presents a sophisticated "Speaker field" visualizer with two mic nodes positioned by `mic.positionX` and `mic.positionY`. However, these are strictly read-only `div`s. A user cannot drag them or adjust their values via knobs.
**Concrete Fix:** 
- Make the mic dots draggable over the SVG/radial layout, firing updates to `mic1.positionX`/`Y`.
- Add explicit X, Y, and Distance knobs for the active mics beneath the visualizer for fine keyboard/accessibility control.

#### [UX] 3.2 Misleading CPU Budget Control
**Severity:** Low
**Evidence:** `src/modules/Grinder/presentations/views/GrinderPanel.tsx` (`NeuralStage`)
**Why it matters:** `neuralCpuBudget` is defined as a discrete Enum-like integer (0, 1, 2) in the model representing tiered processing allocations, but it is rendered using a standard continuous `GrinderKnob` with `step={1}`. This is poor UX for discrete tiered choices (Eco / Balanced / Full).
**Concrete Fix:** 
- Replace the knob with a 3-way `DawPluginChip` switch or a segmented toggle component that clearly labels what 0, 1, and 2 mean.

---

### 4) Structural/Code Health Issues

#### [HEALTH] 4.1 Deprecated Panel APIs are still present
**Severity:** Low
**Evidence:** `src/modules/Workspace/useCases/panels/devicePanels/onPanelShowGrinder.ts` and `showGrinderPanel.ts`
**Why it matters:** `showGrinderPanel` and `onPanelShowGrinder` exist but are marked as `@deprecated` in favor of a unified `showDevicePanel` pattern. Leaving deprecated files in active workflows creates confusion and violates architecture cleanliness rules.
**Concrete Fix:** 
- Delete both deprecated files.
- Update any remaining callers to use the unified `showDevicePanel({ deviceType: 'grinder' })`.

#### [HEALTH] 4.2 Pedal Parameters Missing from `PARAM_MAP`
**Severity:** Medium
**Evidence:** `src/modules/AudioEngine/services/grinderProcessor.ts`
**Why it matters:** `PARAM_MAP` maps incoming IPC parameter names to Rust function signatures. The pedal parameters (`preCompressorThreshold`, `preOverdriveDrive`, etc.) are actively sent over IPC by `syncSupportedPedals` but do not exist in `PARAM_MAP`. They rely on the fragile fallback `rustName = msg.name`, assuming the Rust codebase expects the exact camelCase JS string. This is fragile and hides implicit dependencies.
**Concrete Fix:** 
- Explicitly declare all supported pedal keys in `PARAM_MAP` to ensure structural integrity and guard against accidental renaming on the Rust side.

#### [HEALTH] 4.3 Severe Testing Gaps in Parameter Bridge
**Severity:** High
**Evidence:** `src/modules/Grinder/useCases/__tests__/grinderParamBridge.spec.ts`
**Why it matters:** The parameter bridge tests only verify the "device not found" early-exit path. The actual tests for `loadGrinderPatchWithAudio` and `setGrinderParamWithAudio` are literal stubs (`expect(subject).toBeDefined()`). The `paramBatcher` logic, `toPatchValue` conversions, and IPC mappings are entirely untested.
**Concrete Fix:** 
- Implement comprehensive tests for `loadGrinderPatchWithAudio` and `setGrinderParamWithAudio` verifying the exact `updateDeviceParam` payloads and batcher flushes.

#### [HEALTH] 4.4 Cargo Clippy on `daw-dsp` (warnings remain)
**Severity:** Medium
**Evidence:** `cargo clippy --manifest-path crates/daw-dsp/Cargo.toml` (**Pass 3, 2026-04-14**): completes with **exit 0**; **173 warnings** (e.g. `too_many_arguments`, fixable suggestions). Former **2 hard errors** were `clippy::approx_constant` on literal `0.7071` in `crates/daw-dsp/src/gluten/sidechain.rs` — **fixed** by using `std::f32::consts::FRAC_1_SQRT_2`.
**Why it matters:** Warning triage and optional `-D warnings` CI still blocked until warnings are addressed or allowed with rationale.
**Concrete Fix:** Incrementally apply `cargo clippy --fix` where safe; chip away at remaining 173 warnings.

---

### 5) Performance Concerns

#### [PERF] 5.1 Massive 60fps Full-Tree Re-renders
**Severity:** Critical
**Evidence:** `src/modules/Grinder/stores/grinderStore.ts` and `GrinderPanel.tsx`
**Why it matters:** The `grinderStore` holds both persistent project truth (`patch`) and volatile, high-frequency telemetry (`inputDb`, `gateOpen`, `neuralCpuPercent`, etc.). `updateGrinderMeters` is called via `requestAnimationFrame` at 60fps, mutating the store. `GrinderPanel` connects to this store at the root (`const state = useStore(grinderStore)`), meaning the entire complex panel, including tabs, knobs, SVG visualizers, and pedal decks, re-renders 60 times a second. This will decimate the UI thread and violate `ui-patterns` and `state-and-write-paths`.
**Concrete Fix:** 
- Remove all meter fields (`inputDb`, `gateOpen`, etc.) from `GrinderState` and `grinderStore`.
- Implement a dedicated volatile telemetry store or a `useGrinderMeters` hook that reads directly from the `SharedArrayBuffer` view bypassing React state for the layout structure.
- Update `StatusMeter` components to subscribe exclusively to the telemetry source, isolating renders to the meters themselves.

---

### 6) Security/Stability Risks

#### [STABILITY] 6.1 Terminal Panic State Without Recovery
**Severity:** High
**Evidence:** `src/modules/AudioEngine/services/grinderProcessor.ts` (`catch (err)`)
**Why it matters:** If the WASM module panics, `_faulted` is set to true and the processor permanently falls back to a dry passthrough. There is no recovery loop and the host is left unaware of the dead plugin (it only posts an `error` message which is merely `logger.warn`'d as "late" in the handshake). A user will experience a sudden mute or dry signal with no UI indication of what happened.
**Concrete Fix:** 
- Propagate the panic message up to `telemetryAllocator` or a runtime status store so the DAW UI knows the instance crashed.
- Render a "Crashed" overlay on the `GrinderPanel` with a "Reload Engine" capability to tear down and instantiate a fresh `GrinderNode`.

---

### 7) Missing Features or Unfinished Integrations

#### [MISSING] 7.1 Incomplete Implementation of Neural Status
**Severity:** Low
**Evidence:** `src/modules/Grinder/models/GrinderPatch.ts` and `GrinderPanel.tsx`
**Why it matters:** The UI references `neuralModelId` and `neuralModelName`, and the `NEURAL_LIBRARY` in the UI is hardcoded. There is no integration with an actual file system or model loader to browse and load custom `.nam` or `.a1` files. It is an unfinished stub.
**Concrete Fix:** 
- Implement a Tauri file dialog integration to load custom neural models.
- Pass the loaded model bytes down to the WASM worklet.

#### [MISSING] 7.2 Unimplemented Cabinet Mics in Rust
**Severity:** High
**Evidence:** `crates/daw-dsp/src/grinder/engine.rs` and `cabinet.rs`
**Why it matters:** The UI implies full control over `mic1` and `mic2` positions (`mic.positionX`, `mic.positionY`), `micBlend`, and `roomAmount`. However, the Rust audio engine entirely ignores these parameters. `set_param` in `engine.rs` does not route them, and the `CabinetConvolver` implementation lacks multi-IR mic-mixing semantics entirely. 
**Concrete Fix:** 
- Implement multi-IR loading and mic interpolation mixing in the `CabinetConvolver` in Rust.
- Wire the mic coordinates from UI to the Rust engine.

---

### 8) Low-Effort/High-Impact Improvements

#### [IMPROVEMENT] 8.1 Consolidate Parameter Synchronization Logic
**Severity:** Low
**Evidence:** `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
**Why it matters:** `AUDIO_SYNC_KEYS` is manually maintained and easily drifts from `GrinderPatch` (as seen in the missing `micBlend` issue).
**Concrete Fix:** 
- Derive `AUDIO_SYNC_KEYS` automatically from `GRINDER_PARAMS` defined in the descriptor or a shared schema, ensuring that every parameter known to the UI is automatically synced to the audio engine.

---

### 9) Recommended Refactors

#### [REFACTOR] 9.1 Extract `GrinderPatch` into an independent state slice
**Severity:** Medium
**Evidence:** `src/modules/Grinder/stores/grinderStore.ts`
**Why it matters:** `GrinderPatch` is a complex object with nested arrays (`prePedals`, `snapshots`) and deep objects (`mic1`). Treating it as a single monolithic block in `grinderStore` makes partial updates clunky.
**Concrete Fix:** 
- Refactor the store to use granular setters or a `useReducer`-like action dispatch model so that updating a single pedal parameter doesn't require deep cloning the entire patch object manually every time.

## Resolved

- **`daw-dsp` clippy hard errors (2026-04-14):** `gluten/sidechain.rs` — replaced `0.7071` with `FRAC_1_SQRT_2` in `SidechainHpf::set_freq` and `SidechainLpf::set_freq`. `cargo clippy -p daw-dsp` now finishes successfully; 173 warnings remain.

## Verification notes (2026-04-14)

### Pass 2

| Claim | Check |
|--------|--------|
| `AUDIO_SYNC_KEYS` | **Confirmed** — `loadGrinderPatchWithAudio.ts` ~L20, iteration ~L171. |
| `cargo clippy` (before fix) | **173 warnings + 2 errors** — see §4.4 history. |
| `replacePatch` / persistence flood | **Not re-verified** — spot-check `GrinderPanel` `DriveDeck` + `loadGrinderPatchWithAudio` when implementing. |
| Telemetry + `useStore(grinderStore)` | **Plausible** — confirm `GrinderPanel` subscription pattern under load. |

### Pass 3 (2026-04-14)

| Step | Result |
|------|--------|
| `cargo clippy --manifest-path crates/daw-dsp/Cargo.toml` | **Exit 0** after `sidechain.rs` fix. |
| `pnpm deps:validate` | **Exit 0** (warnings only in cruise output). |

### Gaps to close next pass
- Diff `AUDIO_SYNC_KEYS` against full `GrinderPatch` / product requirements (`micBlend`, `postPedals`, etc.).
- Triage the **173** clippy warnings if CI requires a clean lint.

### Pass 4 (2026-04-14) — `replacePatch` → full sync

| Claim | Result |
|--------|--------|
| **`replacePatch` → `loadGrinderPatchWithAudio`** | **Confirmed** — `GrinderPanel.tsx` ~1390–1391 `replacePatch` calls `loadGrinderPatchWithAudio(deviceId, next)`. |
| **Drive tab continuous knobs** | **Confirmed** — `DriveDeck` (`~721+`) `RotaryKnob` `onChange` calls `replacePatch({ ...patch, prePedals: upsertPedal(...) })` — **each** drag tick replaces the whole patch path. |
| **Full `AUDIO_SYNC_KEYS` + persist per replace** | **Confirmed** — `loadGrinderPatchWithAudio.ts` ~171–175 loops **every** `AUDIO_SYNC_KEYS` entry → `updateDeviceParamFn` + `persistDeviceParamFn` per key. Persistence flood for drive knob drags **matches** §1.1. |
