# Audit: Fermenter Codebase

## Goal

Ensure the Fermenter synthesizer module (JS/TS boundary, UI state management, and WASM integration) is robust, performant, sample-accurate, and well-architected for a production-ready DAW environment. It must accurately reflect engine state visually, handle automation gracefully, and be maintainable without high risk of desync between frontend and Rust models.

## Priorities

1. **Performance & Rendering:** Restructure `FermenterPanel` store subscriptions to avoid catastrophic UI re-rendering when telemetry (meters/scope) is activated at 30Hz.
2. **Telemetry & Visuals:** Restore missing telemetry (meters, oscilloscope) to make the UI functional.
3. **State Sync & Maintenance:** Fix `macros` drop bug in preset loading, automate/harden `PARAM_MAP`, and eliminate `typeof value === 'number'` filtering loops that desync arrays.
4. **Timing Accuracy:** Enable sample-accurate parameter automation to prevent block-aligned zipper noise.

## Findings

- **Architecture:** The synthesizer relies on an `AudioWorkletNode` (`FermenterNode`) communicating with a WASM module (`FermenterInstance`) via `MessagePort`.
- **State Management:** The UI state lives in `fermenterStore`, but the UI is entirely disconnected from audio engine telemetry. Peak levels and scope data are stubbed in the state but never fed data from the worklet.
- **WASM Integration:** `fermenterProcessor.ts` manually maps JS camelCase parameters to Rust snake_case via `PARAM_MAP`. 
- **Parameter Batching:** `setFermenterParamWithAudio` batches parameter updates via `requestAnimationFrame` to limit MessagePort flooding, which is a good performance pattern for UI dragging, but unsuitable for automation (playback).
- **Automation Pipeline:** Parameter changes are sent without `sampleFrame`, which forces them to execute immediately on the worklet block boundary, defeating the internal `_queue` scheduling system.
- **React Rendering:** `FermenterPanel` reads the entire `FermenterState` object via `useStore` at the top level.
- **Store Updates:** Randomizing a patch or loading a preset iteratively calls `updateDeviceParam` and `persistDeviceParam` ~80 times in a synchronous loop.

## Issues

### 1. Incomplete Data Sync drops Macros on Preset Load
- **Severity:** High (Functional Correctness)
- **Evidence:** In `loadFermenterPatchWithAudio.ts` and `applyMorphedPatch.ts`, the loop iterates over `Object.entries(patch)` and only pushes the parameter if `typeof value === 'number'`. Because `patch.macros` is an array, it is skipped. Loading a preset will update the UI but the macro values will *never* reach the WASM audio engine.
- **Needed:** Update the iteration logic to explicitly handle arrays (like `macros`) and send them to the audio engine (either individually or as an array message).

### 2. Catastrophic Re-render on Telemetry Updates
- **Severity:** High (Performance)
- **Evidence:** `FermenterPanel.tsx` calls `const state = useStore(fermenterStore)[deviceId]`. If `peakL`, `peakR`, or `scopeBuffer` are updated at 30-60Hz by the worklet, the ENTIRE `FermenterPanel` component—including `SignalFlowView` and its canvas redraws—will re-render 30-60 times a second.
- **Needed:** Scope subscriptions using selector functions (e.g. `useStore(fermenterStore, state => state[deviceId]?.patch)`), and make `OutputMeter` and `Oscilloscope` subscribe to *only* their required telemetry slices directly.

### 3. Missing Audio Telemetry (Meters & Oscilloscope)
- **Severity:** High (UX)
- **Evidence:** `fermenterStore.ts` defines `peakL`, `peakR`, and `scopeBuffer`. However, `fermenterProcessor.ts` never posts this data back to the main thread. The `Oscilloscope` and `OutputMeter` components sit idle.
- **Needed:** Add a telemetry timer/counter in `fermenterProcessor.ts`'s `process` loop to sample peak levels and buffer data, and `postMessage` it back. Update `FermenterNode.ts` to listen for these messages and update the store.

### 4. Parameter Updates are Block-Aligned (Not Sample Accurate)
- **Severity:** High (Audio Quality)
- **Evidence:** In `FermenterNode.ts`, the `setParam` function posts `{ type: 'param', name, value }` without a `sampleFrame` property. In `fermenterProcessor.ts`, `_handleMessage` only enqueues if `msg.sampleFrame !== undefined`; otherwise it executes immediately (`_dispatch`).
- **Needed:** Update `setParam` in `FermenterNode.ts` to accept `sampleFrame?: number` and pass it to the worklet. Update `TrackNode.ts` and the automation engine to pass the calculated frame.

### 5. Fragile manual PARAM_MAP and missing `macros`
- **Severity:** Medium (Maintainability)
- **Evidence:** `fermenterProcessor.ts` maintains a 100+ line `PARAM_MAP` dictionary. The `macros` parameter in `FermenterPatch` is omitted entirely from this map.
- **Needed:** Ensure all `FermenterPatch` properties (including macros) are correctly mapped. Ideally, replace `PARAM_MAP` with an auto-generated shared contract or a simple regex-based camel-to-snake converter in the processor.

### 6. SignalFlowView Re-renders Unnecessarily
- **Severity:** Medium (Performance)
- **Evidence:** In `SignalFlowView.tsx`, the `useMemo` and `useEffect` hooks depend on the *entire* `patch` object. Changing *any* parameter (e.g., turning a knob) forces the entire graph to be recalculated and the canvas to be cleared and redrawn.
- **Needed:** Extract only the structural parameters (`numLayers`, `warpMode`, `filterModel`, effect mix values, etc.) that actually dictate the signal flow layout, and use those as dependencies instead of the full `patch` object.

### 7. Error Handling lacks recovery
- **Severity:** Medium (Stability)
- **Evidence:** `fermenterProcessor.ts` catches WASM errors, sets `_faulted = true`, and stops processing. There is no recovery mechanism to restart the node or reload the WASM.
- **Needed:** Implement a node-reloading sequence in `FermenterNode` or `AudioEngine` when an `error` message is received from the worklet.

### 8. Linter hack / dead code in FermenterPanel
- **Severity:** Low (Code Health)
- **Evidence:** `FermenterPanel.tsx` contains `const [version, setVersion] = useState(0); version;`. This is an unidiomatic hack to force re-renders. 
- **Needed:** Remove the `version` hack. Proper React state management/keys should handle re-renders when patches are saved or loaded.

## Suggested approaches

1. **React State:** Immediately refactor `FermenterPanel` to use granular selector subscriptions via `useStore` before implementing telemetry. This prevents introducing a catastrophic performance regression when telemetry is turned on.
2. **Preset Loading:** Update `loadFermenterPatchWithAudio` to either accept the whole patch structure in the Rust backend, or iterate and send `macros[0]...macros[7]` explicitly since `typeof value === 'number'` misses arrays.
3. **Telemetry:** In the worklet, allocate a shared `SharedArrayBuffer` (if available and headers permit) or use standard `MessagePort.postMessage` at ~30Hz. Send peak values and a decimated scope buffer.
4. **Timing:** Modify the automation playback system to provide precise `sampleFrame` offsets for parameter events.
5. **Data Mapping:** Write a camelToSnake runtime string converter in the processor to drastically reduce surface area for bugs, instead of a manual map.

## Risks

- **UI Freezes:** Without the React subscription fix, high-frequency messaging for UI updates will cause garbage collection spikes and severe UI stutter.
- **Zipper Noise:** Without sample-accurate parameters, fast automation on cutoff or pitch will sound stepped and broken (zipper noise).
- **Desync:** Hardcoded maps (`PARAM_MAP`) and filtering out non-numbers (`typeof value === 'number'`) guarantee that macros and any newly added Rust parameters will be silently ignored.

## Resolved

*(None yet)*