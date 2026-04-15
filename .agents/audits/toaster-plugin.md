# Toaster Plugin Audit

## Goal
The Toaster plugin must operate as a stable, high-performance, and multi-instance capable drum machine within the Sourdaw architecture. It must provide robust state management (one state per instance), allocation-free real-time audio processing in its AudioWorklet, and accurate hydration of all parameters from the UI/Store to the Rust DSP engine. 

## Current state
The Toaster plugin currently functions as a single global drum machine, hard-coupled to singleton state stores and hydration workflows. While the Rust DSP engine is largely allocation-free and well-structured, the TypeScript layer connecting the UI, State, and AudioNode makes severe singleton assumptions that break multi-instance support. Additionally, there are severe violations of the Web Audio real-time processing constraints in the JavaScript AudioWorklet wrapper (`ToasterProcessor.js`), and missing/ignored parameters bridging the gap between TS and Rust. Several DSP algorithms are missing sample-rate compensation, and the sequencer schedules Web Audio triggers via Javascript's `setTimeout` which introduces severe timing jitter.

## Findings
- **Singleton architecture:** The UI, state, and hydration logic assume there is only one Toaster plugin in the entire project. This manifests across `toasterStore`, `loadToasterKit`, `toasterSubscriber`, `sequencerPlayback`, and the param bridge.
- **Audio Thread allocations:** The AudioWorklet processor allocates and mutates memory during the hot audio loop, which will cause garbage collection pauses and audio dropouts.
- **Disconnected global effects:** The UI presents global controls for effects (Reverb Mix / Delay Mix), but the underlying Rust DSP is designed as a send-effect architecture that ignores global mix levels, rendering the UI knobs non-functional.
- **Partial hydration:** Several parameters exist in the Rust engine and TypeScript models but are completely dropped during state hydration and kit loading.
- **Sample-Rate Dependencies in DSP:** Several parameters and hardcoded decay coefficients in the DSP layer are per-sample rather than time-based, causing the audio to sound significantly different at 44.1kHz vs 96kHz.
- **Sequencer Timing Jitter:** The pattern sequencer relies on `setTimeout` to directly trigger the Web Audio `noteOn` method without providing a precise `sampleFrame`, throwing away the sample-accurate timing guarantees of Web Audio.

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

**3. Param Bridge Modifies Global Store**
- **Severity:** Critical
- **Evidence:** `src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts` and `setToasterKitParam.ts`. They call `updatePad` and `updateKit` which mutate the global `toasterStore`.
- **Why it matters:** Exacerbates the Singleton limitation. Twisting a knob on Toaster B's UI correctly sends DSP updates to Toaster B via `deviceId`, but updates the global UI state, meaning Toaster A's UI incorrectly reflects Toaster B's changes, detaching the UI from reality.
- **Concrete Fix:** Refactor the store mutators to accept a `deviceId` and only mutate that instance's state.

**4. Sequencer Web Audio Jitter (setTimeout Scheduling)**
- **Severity:** Critical
- **Evidence:** `src/modules/Toaster/useCases/sequencerPlayback.ts` uses `setTimeout(fire, totalDelayMs)` to trigger drum pads.
- **Why it matters:** `setTimeout` runs on the main thread and is subject to the Javascript event loop. If the UI is rendering or the garbage collector runs, the drum hit will be delayed. A drum machine requires sample-accurate timing.
- **Concrete Fix:** Calculate the exact `sampleFrame` for the trigger time based on `totalDelayMs` and pass it to `dn.toasterControls.noteOn(padIndex, velocity, note, sampleFrame)`. Remove the `setTimeout` wrapper entirely and use a lookahead window to schedule events into the worklet's queue ahead of time.

### 2) Functional issues

**1. Missing Pad Parameter Hydration**
- **Severity:** High
- **Evidence:** `loadToasterKitPreset` in `loadToasterKit.ts` and `initToasterSubscribers` in `toasterSubscriber.ts`.
- **Why it matters:** Parameters like `busRoute`, `transientAttack`, and `transientSustain` are defined in `PAD_PARAM_MAP` and exist on the `PadState`, but they are completely omitted from the hydration loops. When a user reloads the project or loads a kit, these parameters are not sent to the WASM engine, reverting to defaults.
- **Concrete Fix:** Add explicit hydration calls for these missing properties in the loop: `controls.setPadParam(i, 'bus_route', pad.busRoute);`, etc.

**2. Disconnected global effect mix knobs**
- **Severity:** High
- **Evidence:** `PlateReverb::set_param` ignores `reverb_mix` (`engine.rs`). `StereoDelay::set_param` stores `delay_mix` into `self.mix`, but `StereoDelay::process` returns full wet taps without applying `self.mix`; summed in `process_block` as `rev_l/r + del_l/r` with no global dry/wet scaling from those fields.
- **Why it matters:** “Space” / global reverb return has no `reverb_mix` effect; “Spray” / `delay_mix` is stored but does not attenuate the delay return in current `process`/`process_block` wiring.
- **Concrete Fix:** Apply `reverb_mix` / `delay_mix` when summing global FX into the master (or remove/label knobs as send-only).

**3. Transient Shaper Audio Clicks**
- **Severity:** Medium
- **Evidence:** `crates/daw-dsp/src/toaster/transient.rs` uses an instantaneous conditional branch (`if is_transient { input * attack_gain } else { input * sustain_gain }`) to apply gain.
- **Why it matters:** Switching instantaneously between two multipliers on a continuous audio signal produces discontinuities (clicks/pops/zipper noise) if the signal is not exactly zero.
- **Concrete Fix:** Introduce a smoothed gain state variable that interpolates (e.g. via a one-pole filter) between `attack_gain` and `sustain_gain` over a few samples.

**4. Tone Filter Sample-Rate Dependency**
- **Severity:** Medium
- **Evidence:** `crates/daw-dsp/src/toaster/engines/kick.rs` `self.tone_state += self.tone_cutoff * (driven - self.tone_state);`. The `tone_cutoff` coefficient is directly set by the 0.01-1.0 parameter.
- **Why it matters:** The kick's tone filter frequency will shift wildly depending on the user's audio interface sample rate (e.g., sounding much darker at 96kHz than at 44.1kHz).
- **Concrete Fix:** Map the `tone` 0-1 parameter to an actual frequency range (e.g., 100Hz - 20000Hz) and calculate a sample-rate compensated 1-pole coefficient using `(2.0 * PI * freq / sample_rate).min(1.0)`.

**5. DSP Choke/Decay Sample-Rate Dependencies**
- **Severity:** Low
- **Evidence:** `crates/daw-dsp/src/toaster/voice.rs` uses `choke_decay = 0.99;`. `crates/daw-dsp/src/toaster/engines/modal.rs` uses `self.amp_decay_coeff *= 0.999;`. `crates/daw-dsp/src/toaster/engines/cymbal.rs` uses `self.decay_coeff = 0.9995;`.
- **Why it matters:** Hardcoded per-sample multipliers mean choke and release fade-outs happen more than twice as fast at 96kHz compared to 44.1kHz, causing inconsistent behavior across user setups.
- **Concrete Fix:** Precalculate decay coefficients dynamically using `(-1.0 / (time_in_seconds * sample_rate)).exp()`.

### 3) UX/UI issues

**1. Panel Global State Coupling**
- **Severity:** High
- **Evidence:** `ToasterPanel.tsx` takes `{ deviceId: string }` as a prop but immediately uses `useStore(toasterStore)`.
- **Why it matters:** Opening two Toaster panels side-by-side will cause them to mirror each other perfectly, regardless of which track they belong to.
- **Concrete Fix:** Scope the React component to read only the slice of `toasterStore` corresponding to its `deviceId`.

### 4) Structural/code health issues

**1. `getFirstToasterDeviceId` Anti-Pattern**
- **Severity:** High
- **Evidence:** `src/modules/Toaster/useCases/toasterParamBridge/getFirstToasterDeviceId.ts`, `sequencerPlayback.ts`, and `triggerPad.ts`.
- **Why it matters:** Relies on scanning tracks to find the *first* Toaster device in the project to dispatch sequencer start/stop commands and triggers. If a user adds a second Toaster, it will never receive sequencer events and won't play.
- **Concrete Fix:** The sequencer playback and pad trigger logic must broadcast to all Toaster `deviceId`s or target them specifically via a passed `deviceId` parameter, rather than grabbing the first one.

**2. Duplicated Hydration Logic**
- **Severity:** Medium
- **Evidence:** The exact same 30-line `for` loop mapping pad parameters is duplicated across `loadToasterKit.ts` and `toasterSubscriber.ts`.
- **Why it matters:** Adding a new parameter requires updating it in two places, which is why `busRoute` and `transientAttack` were missed.
- **Concrete Fix:** Extract the parameter mapping loop into a shared pure function `hydrateToasterEngine(controls, kit)`.

**3. Incomplete Plugin Descriptor**
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
- **Severity:** Resolved (Lofi processor exists in `lofi.rs` and properly mimics SP-1200 style sample-and-hold without pre-aliasing filter, which is correct for that aesthetic).

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
3. Remove `setTimeout` from `sequencerPlayback.ts` and use sample-accurate `sampleFrame` scheduling.
4. Remove `getFirstToasterDeviceId` and refactor sequencer/triggers to broadcast or target specific Toasters.
5. Fix the param bridge (`setToasterPadParam`/`setToasterKitParam`) to only mutate the specific instance state.
6. Extract and complete the duplicated hydration logic to include missing parameters (`busRoute`, `transientAttack`, etc.).
7. Fix the Transient Shaper's conditional gain application to eliminate audio clicks.
8. Apply sample-rate compensation to Kick Tone and Voice Choke Decay DSP across all engines.

## Risks
If the singleton issue is not fixed, the first user who tries to add two drum tracks will completely corrupt their project state and audio outputs. If the `splice` memory allocation in the worklet isn't fixed, it will cause unpredictable click/pop artifacts on slower machines during garbage collection. `setTimeout` scheduling will result in amateurish, jittery drum rhythms that drift out of sync with the DAW timeline. Audio clicks from the Transient Shaper will make the plugin sound broken.

## Suggested approaches
1. **Singleton Fix:** Change `ToasterState` to `Record<string, ToasterInstanceState>`. Update the initialization event in `toasterSubscriber.ts` to create a default state entry for new `deviceId`s if they don't exist. Update `ToasterPanel` to grab state using its `deviceId` prop. 
2. **AudioWorklet Queue Fix:** Pre-allocate a constant-size array of 128 event objects in `ToasterProcessor`. Maintain `head` and `tail` pointers to represent a ring buffer. Dequeue events without reallocating arrays.

## Resolved
- None yet.

## Verification notes (2026-04-14)

### Pass 2 — DSP + worklet

| Claim | Check |
|--------|--------|
| `setTimeout` in sequencer | **Confirmed** — `sequencerPlayback.ts` uses `setTimeout` for tick/trigger paths. |
| `_drainQueue` / `_enqueue` `splice` | **Confirmed** — `toasterProcessor.ts` ordered insert `splice(lo,0,msg)` + batch `splice(0, drained)`. |
| **Global reverb mix vs delay mix** | **Refined** — `PlateReverb::set_param` ignores `"reverb_mix"` (`engine.rs` ~84). `StereoDelay` stores `"delay_mix"` in `self.mix` (`~145`) but `StereoDelay::process` (`~117–136`) returns **100% wet taps** and **never multiplies by `self.mix`**; `process_block` (`~492–495`) adds `rev_l/r + del_l/r` to bus. **UI “Space” (reverb) knob:** still ineffective at global return. **“Spray” (delay):** `delay_mix` is **stored but unused** in delay output — both global returns are effectively send-only unless another path applies `mix`. |
| Singleton store / first-track | **Not runtime-tested** — still treat as architectural risk. |

### Pass 3 (2026-04-14) — store shape

| Claim | Result |
|--------|--------|
| **Global `toasterStore` (not per-device)** | **Confirmed** — `toasterStore.ts` exports one `createStore<ToasterState>` with **no** `deviceId` map; `ToasterState` is a single kit + UI fields. Multiple Toaster devices would share one reactive tree unless the panel namespaces elsewhere (not in this store). **Multi-instance risk** remains **architectural**, not runtime-benchmarked. |