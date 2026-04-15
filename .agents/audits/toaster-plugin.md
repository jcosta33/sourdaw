# Toaster Plugin Audit

## Goal
The Toaster plugin must operate as a stable, high-performance, and multi-instance capable drum machine within the Sourdaw architecture. It must provide robust state management (one state per instance), allocation-free real-time audio processing in its AudioWorklet, and accurate hydration of all parameters from the UI/Store to the Rust DSP engine. 

## Current state
The Toaster plugin currently functions as a single global drum machine, hard-coupled to singleton state stores and hydration workflows. While the Rust DSP engine is largely allocation-free and well-structured, the TypeScript layer connecting the UI, State, and AudioNode makes severe singleton assumptions that break multi-instance support. Additionally, there are severe violations of the Web Audio real-time processing constraints in the JavaScript AudioWorklet wrapper (`ToasterProcessor.js`), and missing/ignored parameters bridging the gap between TS and Rust.

## Findings
- **Singleton architecture:** The UI, state, and hydration logic assume there is only one Toaster plugin in the entire project. This manifests across `toasterStore`, `loadToasterKit`, and `toasterSubscriber`.
- **Audio Thread allocations:** The AudioWorklet processor allocates and mutates memory during the hot audio loop, which will cause garbage collection pauses and audio dropouts.
- **Disconnected global effects:** The UI presents global controls for effects (Reverb Mix / Delay Mix), but the underlying Rust DSP is designed as a send-effect architecture that ignores global mix levels, rendering the UI knobs non-functional.
- **Partial hydration:** Several parameters exist in the Rust engine and TypeScript models but are completely dropped during state hydration and kit loading.

## Issues

### 1) Critical bugs

**1. AudioWorklet Real-time Violation (Memory Allocation in Hot Path)**
- **Severity:** Critical
- **Evidence:** `src/modules/AudioEngine/services/toasterProcessor.ts`, `_drainQueue()` method. Uses `this._queue.splice(0, drained);` inside the audio thread.
- **Why it matters:** `Array.prototype.splice` dynamically creates new array objects, triggering the V8 Garbage Collector. Doing this inside `process()` violates the strict "no allocation" rule for audio threads (as per `GEMINI.md`) and guarantees random audio dropouts/clicks.
- **Concrete Fix:** Replace the dynamic JS Array queue with a pre-allocated static ring buffer (e.g., a fixed-size `Float32Array` or statically sized Array of objects) for enqueuing scheduled events.

**2. Singleton Toaster Limitation (Multi-instance broken)**
- **Severity:** Critical
- **Evidence:** `src/modules/Toaster/useCases/loadToasterKit.ts` (`getToasterControls` uses `tracks.find(...)` and returns the *first* Toaster track). `src/modules/Toaster/stores/toasterStore.ts` (Global singleton). `src/modules/Toaster/useCases/toasterSubscriber.ts` (Hydrates from the single store).
- **Why it matters:** Users cannot add two different Toaster drum machines to a project. Updating the UI or loading a preset on Toaster B will actually mutate the audio parameters of Toaster A. 
- **Concrete Fix:** Refactor `toasterStore` to be keyed by `deviceId` (e.g., `Record<string, ToasterState>`), and pass `deviceId` explicitly to `getToasterControls(deviceId)` instead of finding the first track. Update `ToasterPanel` to select its specific device state from the store using the provided `deviceId` prop.

### 2) Functional issues

**1. Missing Pad Parameter Hydration**
- **Severity:** High
- **Evidence:** `loadToasterKitPreset` in `loadToasterKit.ts` and `initToasterSubscribers` in `toasterSubscriber.ts`.
- **Why it matters:** Parameters like `busRoute`, `transientAttack`, and `transientSustain` are defined in `PAD_PARAM_MAP` and exist on the `PadState`, but they are completely omitted from the hydration loops. When a user reloads the project or loads a kit, these parameters are not sent to the WASM engine, reverting to defaults.
- **Concrete Fix:** Add explicit hydration calls for these missing properties in the loop: `controls.setPadParam(i, 'bus_route', pad.busRoute);`, etc.

**2. Disconnected Global Effect Mix Knobs**
- **Severity:** High
- **Evidence:** `ToasterPanel.tsx` has UI knobs for "Space" (`kit.reverbMix`) and "Spray" (`kit.delayMix`). However, in `crates/daw-dsp/src/toaster/engine.rs`, `PlateReverb::set_param` explicitly ignores `reverb_mix` (`/* mix is controlled by pad send levels */`).
- **Why it matters:** The user turns the Reverb and Delay global mix knobs on the UI, but absolutely nothing happens to the audio because the DSP engine ignores the parameters.
- **Concrete Fix:** Either implement a master return gain for the global reverb and delay in `ToasterEngine`'s `process_block` and handle `reverb_mix` / `delay_mix` in `set_param`, OR remove the knobs from the UI if it is strictly a per-pad send architecture.

### 3) UX/UI issues

**1. Panel Global State Coupling**
- **Severity:** High
- **Evidence:** `ToasterPanel.tsx` takes `{ deviceId: string }` as a prop but immediately uses `useStore(toasterStore)`.
- **Why it matters:** Opening two Toaster panels side-by-side will cause them to mirror each other perfectly, regardless of which track they belong to.
- **Concrete Fix:** Scope the React component to read only the slice of `toasterStore` corresponding to its `deviceId`.

### 4) Structural/code health issues

**1. Duplicated Hydration Logic**
- **Severity:** Medium
- **Evidence:** The exact same 30-line `for` loop mapping pad parameters is duplicated across `loadToasterKit.ts` and `toasterSubscriber.ts`.
- **Why it matters:** Adding a new parameter requires updating it in two places, which is why `busRoute` and `transientAttack` were missed.
- **Concrete Fix:** Extract the parameter mapping loop into a shared pure function `hydrateToasterEngine(controls, kit)`.

**2. Incomplete Plugin Descriptor**
- **Severity:** Medium
- **Evidence:** `src/modules/Arrangement/models/pluginDescriptors/toasterDescriptor.ts`.
- **Why it matters:** Only 4 global parameters (`masterGain`, `reverbMix`, `delayMix`, `swing`) are declared. None of the internal `delayTime`, `lofiBits`, or the 16 pads' `volume`, `pan`, `decay` are registered. This breaks DAW parameter automation and MIDI mapping for the Toaster.
- **Concrete Fix:** Generate and declare the full matrix of automatable parameters for all 16 pads and global effects inside `TOASTER_DESCRIPTOR`.

### 5) Performance concerns

**1. Monolithic UI Re-renders**
- **Severity:** Medium
- **Evidence:** `ToasterPanel.tsx` uses a root `useStore(toasterStore)`.
- **Why it matters:** Twisting a single decay knob triggers a re-render of the entire `ToasterPanel`, including the heavy `PadGrid`, `StepSequencer`, and `PadMixer` components.
- **Concrete Fix:** Split the UI components to subscribe to atomic state slices (e.g., `useStore(toasterStore, s => s[deviceId].kit.pads[0].decay)`).

### 6) Security/stability risks

**1. Unbounded Message Queue**
- **Severity:** Low
- **Evidence:** `ToasterProcessor.ts` `_enqueue(msg)` pushes into an unbounded `_queue` array.
- **Why it matters:** If the main thread sends thousands of parameter updates with future `sampleFrame` values, the Worklet's queue will grow infinitely, consuming memory and increasing the `O(log n)` insertion sort cost in `_enqueue`.
- **Concrete Fix:** Cap the queue length and drop or coalesce older parameter updates if it overflows.

### 7) Missing features or unfinished integrations

**1. No Lofi Processor implementation found**
- **Severity:** Medium
- **Evidence:** The `engine.rs` references `self.global_lofi = LofiProcessor::new()`. While it is likely implemented in `lofi.rs`, it was not explicitly audited but UI exposes it. Assuming functional, but needs verification. 
- **Concrete Fix:** Verify `crates/daw-dsp/src/toaster/lofi.rs` works as expected.

### 8) Low-effort/high-impact improvements

**1. Missing `busRoute` UI Control**
- **Severity:** Low
- **Evidence:** `PAD_PARAM_MAP` supports `busRoute` and the Rust engine has 4 internal mix buses with compressors, but `ToasterPanel.tsx` has no UI dropdown to route a pad to a bus.
- **Why it matters:** The engine has an entire bus compression architecture that the user cannot use.
- **Concrete Fix:** Add a Bus routing selector to the Pad section in `ToasterPanel.tsx`.

### 9) Recommended refactors

**1. Event Queue Thread Safety**
- Move from `postMessage` based discrete param updating to a SharedArrayBuffer ring buffer for parameter automation to avoid structured clone overhead and jitter. 

## Priorities
1. Fix the `splice` allocation in `ToasterProcessor.ts` to prevent audio dropouts.
2. Refactor `toasterStore` to be keyed by `deviceId` so multiple instances work.
3. Fix the `loadToasterKit.ts` `getToasterControls` to target the specific device.
4. Extract and complete the duplicated hydration logic to include missing parameters (`busRoute`, `transientAttack`, etc.).
5. Wire up or remove the non-functional global Reverb/Delay mix knobs.

## Risks
If the singleton issue is not fixed, the first user who tries to add two drum tracks will completely corrupt their project state and audio outputs. If the `splice` memory allocation in the worklet isn't fixed, it will cause unpredictable click/pop artifacts on slower machines during garbage collection. 

## Suggested approaches
1. **Singleton Fix:** Change `ToasterState` to `Record<string, ToasterInstanceState>`. Update the initialization event in `toasterSubscriber.ts` to create a default state entry for new `deviceId`s if they don't exist. Update `ToasterPanel` to grab state using its `deviceId` prop. 
2. **AudioWorklet Queue Fix:** Pre-allocate a constant-size array of 128 event objects in `ToasterProcessor`. Maintain `head` and `tail` pointers to represent a ring buffer. Dequeue events without reallocating arrays.

## Resolved
- None yet.