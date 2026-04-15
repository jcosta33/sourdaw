# Audit: Fermenter Codebase

## Goal

Ensure the Fermenter synthesizer module (JS/TS boundary, UI state management, and WASM integration) is robust, performant, sample-accurate, and well-architected for a production-ready DAW environment. It must accurately reflect engine state visually, handle automation gracefully, and be maintainable without high risk of desync between frontend and Rust models.

## Priorities

1. **Performance & Rendering:** Restructure `FermenterPanel` store subscriptions to avoid catastrophic UI re-rendering when telemetry (meters/scope) is activated at 30Hz.
2. **Telemetry & Visuals:** Restore missing telemetry (meters, oscilloscope) to make the UI functional.
3. **State Sync & Maintenance:** Fix `macros` drop bug in preset loading, automate/harden `PARAM_MAP`, and fix the `macros` interpolation gap in the morphing engine.
4. **Timing Accuracy:** Enable sample-accurate parameter automation to prevent block-aligned zipper noise.

## Findings

- **Architecture:** The synthesizer relies on an `AudioWorkletNode` (`FermenterNode`) communicating with a WASM module (`FermenterInstance`) via `MessagePort`.
- **State Management:** The UI state lives in `fermenterStore`, but the UI is entirely disconnected from audio engine telemetry. Peak levels and scope data are stubbed in the state but never fed data from the worklet.
- **WASM Integration:** `fermenterProcessor.ts` manually maps JS camelCase parameters to Rust snake_case via `PARAM_MAP`. 
- **Morphing Engine:** The `TransformPad` uses `bilinearPatch` to lerp between 4 patches. It then iteratively calls `setFermenterParamWithAudio` for ~100 parameters on every drag move.
- **Preset System:** `fermenterPresets.ts` uses a flattened `macro0...macro7` naming scheme which conflicts with the `FermenterPatch` model's `macros: number[]` array, leading to dropped macro values during loading and morphing.
- **Automation Pipeline:** Parameter changes are sent without `sampleFrame`, which forces them to execute immediately on the worklet block boundary, defeating the internal `_queue` scheduling system.
- **React Rendering:** `FermenterPanel` reads the entire `FermenterState` object via `useStore` at the top level, making it extremely sensitive to any high-frequency state updates.

## Issues

### 1. Macros Dropped during Preset Load & Morph
- **Severity:** High (Functional Correctness)
- **Evidence:** 
    - `fermenterPresets.ts` exports macros as `macro0`, `macro1`, etc. 
    - `TransformPad.tsx`'s `presetToPatch` and `FermenterPanel.tsx`'s `loadPresetPatch` iterate keys and only map if `key in patch`. `macro0` is NOT a key in `FermenterPatch`, so it is ignored.
    - `lerpPatch` in `bilinearPatch.ts` only lerps `typeof va === 'number'`, silently skipping the `macros` array.
- **Needed:** Harmonize the preset storage and domain model. Update `lerpPatch` to interpolate arrays (specifically macros) so the Transform Pad actually morphs performance parameters.

### 2. Catastrophic Re-render on Telemetry Updates
- **Severity:** High (Performance)
- **Evidence:** `FermenterPanel.tsx` calls `const state = useStore(fermenterStore)[deviceId]`. If `peakL`, `peakR`, or `scopeBuffer` are updated at 30-60Hz by the worklet, the ENTIRE `FermenterPanel` component—including `SignalFlowView` and its canvas redraws—will re-render 30-60 times a second.
- **Needed:** Scope subscriptions using selector functions (e.g. `useStoreSelector`), and make `OutputMeter` and `Oscilloscope` subscribe to *only* their required telemetry slices directly.

### 3. Messaging Storm during Morphing
- **Severity:** High (Performance)
- **Evidence:** `applyMorphedPatch.ts` iterates over `Object.entries(patch)` and calls `setFermenterParamWithAudio` for every numeric value. This results in ~80+ `postMessage` calls per mouse move event. 
- **Needed:** Implement a `loadPatch` or `morphPatch` message in the worklet that accepts a full or partial patch object, reducing 80 messages to 1 per frame.

### 4. Parameter Updates are Block-Aligned (Not Sample Accurate)
- **Severity:** High (Audio Quality)
- **Evidence:** In `FermenterNode.ts`, the `setParam` function posts `{ type: 'param', name, value }` without a `sampleFrame` property. In `fermenterProcessor.ts`, `_handleMessage` only enqueues if `msg.sampleFrame !== undefined`; otherwise it executes immediately (`_dispatch`).
- **Needed:** Update `setParam` in `FermenterNode.ts` to accept `sampleFrame?: number` and pass it to the worklet. Update the automation engine to pass the calculated frame.

### 5. Linear Taper on Logarithmic Parameters (Filter Cutoff)
- **Severity:** Medium (UX)
- **Evidence:** `FilterSection.tsx` uses a `RotaryKnob` for `filterCutoff` (20Hz-20kHz). If the knob uses a linear mapping (default for standard UI sliders), the 20Hz-1kHz range (the most useful range) is squeezed into the first 5% of the knob's rotation.
- **Needed:** Ensure `RotaryKnob` or the `FilterSection` uses a logarithmic scaling function for cutoff and envelope times.

### 6. Fragile manual PARAM_MAP
- **Severity:** Medium (Maintainability)
- **Evidence:** `fermenterProcessor.ts` maintains a 100+ line `PARAM_MAP` dictionary. Any new parameter added to the Rust engine must be manually added here or it will be silently ignored.
- **Needed:** Ideally, replace `PARAM_MAP` with a regex-based camel-to-snake converter in the processor to drastically reduce surface area for bugs.

### 7. Missing Audio Telemetry (Meters & Oscilloscope)
- **Severity:** High (UX)
- **Evidence:** `fermenterStore.ts` defines `peakL`, `peakR`, and `scopeBuffer`. However, `fermenterProcessor.ts` never posts this data back to the main thread. 
- **Needed:** Add a telemetry timer/counter in `fermenterProcessor.ts`'s `process` loop to sample peak levels and buffer data, and `postMessage` it back.

## Suggested approaches

1. **Selector Subscriptions:** Introduce `useStoreSelector` and refactor `FermenterPanel` to avoid full re-renders.
2. **Batch Messaging:** Update the worklet to handle a single "patch" message instead of individual parameter messages for bulk updates (morphing/presets).
3. **Array Interpolation:** Update `lerpPatch` to handle `macros: number[]`.
4. **Logarithmic Scaling:** Fix the mapping for `filterCutoff` and `ampAttack/Decay/Release` in the UI components.

## Risks

- **UI Freezes:** High-frequency messaging for UI updates (telemetry) + full-panel React re-renders = frozen UI.
- **Zipper Noise:** Without sample-accurate parameters, fast automation sounds stepped.
- **Inert Performance:** A synth where the Transform Pad doesn't morph macros feels "dead" to performers.

## Resolved

*(None yet)*