# Crumbs (Sampler) Plugin Audit

## Goal
The Crumbs plugin (internally referenced as "Sampler") must provide a real-time-safe, polyphonic, zero-allocation sample playback and manipulation engine. It must fully integrate into the `daw-engine` audio graph, support multi-instance usage without state collisions, handle audio files safely without unbounded memory growth, and render a high-performance React UI that correctly reflects engine state.

## Current State
The Crumbs plugin possesses a highly detailed, visually complete UI (`SamplerPanel.tsx`) that successfully invokes Tauri IPC commands (`samplerBridge.ts`) to a Rust backend (`commands::sampler`). However, the Rust DSP engine (`SamplerEngine`) is **completely disconnected from the DAW audio graph**. It runs exclusively within Tauri's command state, decodes audio, performs analysis (peaks, pitch, BPM), and updates UI state, but **it produces zero sound**. Furthermore, critical architectural violations in both TypeScript and Rust prevent it from functioning as a real-time-safe, multi-instance DAW plugin.

## Priorities
1. **Wire the engine to the audio graph:** `SamplerEngine` must be integrated into `daw-engine` so `process_block` is actually called.
2. **Resolve singleton state collision:** Convert `samplerStore`, `padStore`, and `sliceStore` to instance-keyed maps or React Context to support multiple plugin instances.
3. **Fix real-time safety violations:** Remove `Mutex` usage around `SamplerEngine` to allow lock-free audio thread execution.
4. **Fix hardcoded sample rate:** `initSamplerEngine` must use the actual `daw-engine` sample rate, not a hardcoded `44100`.
5. **Fix render loop performance crash:** Stop `SamplerPanel` from re-rendering at 60fps due to naive state-based playhead tracking.

## Findings

### 1. Critical Bugs & Missing Integrations

**Issue 1: The Engine is a "Ghost" (Produces No Sound)**
- **Evidence:** `crates/daw-dsp/src/sampler/engine.rs` contains a complete `process_block` implementation, but a codebase search reveals it is **never called**. `SamplerEngine` instances are stored in `src-tauri/src/commands/sampler.rs` inside a Tauri `State` and are never passed to `daw-engine`.
- **Impact:** The plugin is entirely silent. It is a mock UI that performs offline file analysis but cannot play back audio.
- **Needed:** Create a `SamplerProcessor` wrapper in `daw-dsp/src/sampler/mod.rs` (following the pattern of `FermenterProcessor` or `ToasterProcessor`). Instantiate it in `daw-engine` and wire its `process_block` into the audio thread. Connect command queues using `rtrb` ring buffers instead of Tauri `Mutex` state.

### 2. DSP & Audio Engine Flaws

**Issue 2: Severe Filter State Corruption (Stereo Bug)**
- **Evidence:** In `crates/daw-dsp/src/sampler/voice.rs` (`render_sample`), the left and right channels are processed sequentially through the *same mono filter instance* (`self.filter.process_mono(left); self.filter.process_mono(right);`).
- **Impact:** This treats L and R as alternating time-domain samples of a single signal, completely destroying the IIR filter state (`z1`, `z2`), injecting Nyquist-frequency garbage, and ruining the stereo image.
- **Needed:** Instantiate two separate `TptSvf` instances per voice (one for the left channel, one for the right channel).

**Issue 3: Fake Loop Crossfading & Interpolator Discontinuities**
- **Evidence:** `SamplerVoice` accepts a `loop_crossfade` parameter, and the header claims "equal-power crossfade", but `advance_position` ignores it entirely, instantly snapping `self.position = start + overshoot`. Furthermore, `cubic_hermite` reads past the end of the loop boundary without wrapping, falling back to `0.0` via `SampleData::read_left`.
- **Impact:** Looped samples will click violently at the loop point. The interpolator will dip to silence at the boundary, and the promised crossfade is entirely missing.
- **Needed:** Implement proper circular array lookups for the 4-point interpolator during looping, and add the missing equal-power crossfade logic at the loop boundary.

**Issue 4: Missing Anti-Aliasing on Pitch Shift**
- **Evidence:** `SamplerVoice` relies entirely on a 4-point cubic Hermite interpolator to read fractional sample positions. There is no bandlimiting pre-filter when `speed > 1.0`.
- **Impact:** Pitching samples up (playing higher notes) will skip samples entirely without bandlimiting, causing severe and highly audible aliasing (foldover distortion).
- **Needed:** Implement mipmapped downsampling for the audio thread (leveraging the `generate_mipmap` currently only used for UI peaks) or a proper windowed sinc interpolator.

### 3. Structural & Architecture Violations

**Issue 5: Singleton UI State Prevents Multi-Instance (State Collision)**
- **Evidence:** `src/modules/Sampler/stores/samplerStore.ts` exports a single `defaultSamplerState` wrapped in `createStore`. `SamplerPanel.tsx` calls `useStore(samplerStore)`.
- **Impact:** If a user adds two "Crumbs" tracks, they will share the exact same UI state. Loading a sample in Track 1 will change the display in Track 2.
- **Needed:** Refactor the sampler stores into a map keyed by `instanceId` or `deviceId` (e.g., `Record<string, SamplerState>`), or wrap the plugin in a React Context that provides a unique store instance per panel.

**Issue 6: Audio Thread Mutex Violation**
- **Evidence:** `src-tauri/src/commands/sampler.rs` wraps the engine instances in `Arc<Mutex<HashMap<String, SamplerEngine>>>`. 
- **Impact:** If `daw-engine` were to access these instances to call `process_block`, it would be forced to lock a Mutex that is concurrently locked by Tauri UI commands. This violates the hard rule: "Audio thread: no allocation, no blocking, no mutex locks."
- **Needed:** Decouple the UI state from the DSP state. Use a Single-Producer/Single-Consumer (SPSC) ring buffer (`rtrb` or `crossbeam-queue`) to send `SamplerCommand` from Tauri to the `daw-engine` real-time thread, just like other plugins.

### 4. Functional & Correctness Issues

**Issue 7: Hardcoded Sample Rate**
- **Evidence:** In `src/modules/Sampler/presentations/views/SamplerPanel.tsx`, `initSamplerEngine(deviceId, 44100)` hardcodes `44100`.
- **Impact:** If the user's audio interface runs at 48kHz or 96kHz, playback pitch and duration will be incorrect because the engine assumes 44.1kHz.
- **Needed:** Query the actual DAW sample rate (e.g., via a global store or a dedicated `get_sample_rate` command) before initializing the engine.

**Issue 8: No Browser / WebAudio Fallback**
- **Evidence:** `src/modules/Sampler/repositories/samplerBridge.ts` wraps every IPC call in `if (!isTauri()) { return; }`. 
- **Impact:** The plugin is entirely non-functional in a standard web browser (non-Tauri build). 
- **Needed:** Implement a WebAudio-based fallback engine or explicitly document and handle the lack of browser support via UI disabled states.

**Issue 9: Web-Incompatible File Loading**
- **Evidence:** `handleSamplerFileDrop` passes `e.dataTransfer.files` to `load_sample(filePath)`. In a browser context, local file paths are restricted.
- **Impact:** Drag-and-drop will fail silently or throw errors in web environments.
- **Needed:** Implement file loading via ArrayBuffer / Blob URL for web environments, passing binary data instead of absolute file paths.

### 5. Security & Stability Risks

**Issue 10: Unbounded Memory Allocation on File Load (OOM Risk)**
- **Evidence:** `load_sample` in `commands/sampler.rs` decodes the entire audio file into an in-memory `Vec<f32>` inside `SampleData`.
- **Impact:** Dropping a 1-hour podcast WAV file will result in gigabytes of RAM allocation, likely causing an Out-Of-Memory crash.
- **Needed:** Impose a strict duration/size limit in `daw_io::decode_audio_file` for sampler loading, or implement a disk-streaming fallback for large files.

### 6. Performance Concerns

**Issue 11: Catastrophic 60fps Full-Panel Re-render**
- **Evidence:** `src/modules/Sampler/presentations/views/SamplerPanel.tsx` tracks playback via `const [playbackFrame, setPlaybackFrame] = useState(0);`. `subscribeToPosition` updates this state up to 60 times per second via a `requestAnimationFrame` loop.
- **Impact:** Every time `playbackFrame` updates, the entire `SamplerPanel` (including `PadGrid`, complex waveform SVGs, and control panels) re-renders. This destroys UI performance and spikes CPU usage when playback is active.
- **Needed:** Decouple the playhead from React state. Pass a mutable `ref` down to `WaveformDisplay`, and let it independently run a `requestAnimationFrame` loop that directly manipulates the DOM node (`cursorRef.current.style.left`).

**Issue 12: Inefficient IPC Polling for Playhead Position**
- **Evidence:** `useCases/positionTracking.ts` sets up an interval to call `get_sampler_position` at 30Hz via Tauri IPC.
- **Impact:** While Tauri IPC is fast, continuous polling of an atomic variable over the IPC boundary for every active Sampler instance wastes CPU cycles and adds overhead compared to shared memory.
- **Needed:** Sync playhead positions using the same shared memory / SharedArrayBuffer mechanism used by the primary DAW transport, or batch metering/position updates into a single periodic event emitted from Rust.

**Issue 13: Naive Loop Parameter Submission**
- **Evidence:** `detectAndApplyLoopPoints` in `smartLoopPoints.ts` sequentially calls `setSamplerParamThrottled` four times to update loop properties.
- **Impact:** Multiple un-batched IPC calls and DSP parameter updates for a single atomic state change (applying a loop region).
- **Needed:** Group parameter updates into a single struct/command like `SetLoopRegion` to ensure transactional state updates on the audio thread.

### 7. UX / Naming Inconsistencies

**Issue 14: Missing Pad Waveforms (Incomplete Feature)**
- **Evidence:** `PadGrid` in `PadGrid.tsx` expects an optional `padPeaks` prop to render mini SVGs for each sample pad. `SamplerPanel.tsx` completely omits this prop.
- **Impact:** The drum pads are visually empty (displaying only a tiny colored dot) instead of showing the sample waveforms they contain, severely degrading the UX.
- **Needed:** Query `get_waveform_peaks` for each loaded pad sample and pass the resulting array to `<PadGrid padPeaks={...} />`.

**Issue 15: "Crumbs" vs "Sampler" Identity Crisis**
- **Evidence:** The sidebar displays "Crumbs", the CSS uses `.crumbs-faceplate`, but the entire directory structure, store names, bridge logic, and device kind refer to "sampler" (`builtin-sampler`, `samplerStore`, `src/modules/Sampler`).
- **Impact:** Cognitive overhead for developers mapping UI concepts to codebase architecture.
- **Needed:** Standardize on one name across the stack. Given the existing ecosystem of culinary names (Fermenter, Toaster, Levain), "Crumbs" should be the official module name, replacing "Sampler" internally.

## Risks
Leaving the DSP engine detached means the single most prominent instrument in the UI is a facade. If users attempt to build projects relying on "Crumbs", they will be confused when renders and playback are silent. The Mutex and Singleton state issues guarantee that once it *is* wired up, it will crash the audio thread and corrupt state across tracks unless those are fixed simultaneously. The React performance flaw (Issue 11) will make the UI janky if playback drives full-panel re-renders at 60fps.

## Resolved
(None yet)

## Verification notes (2026-04-14)

### Pass 2

| Claim | Check |
|--------|--------|
| `SamplerEngine` not in `daw-engine` graph | **Confirmed** — `scheduler.rs` only `PluginCore::Knead` / `Native`; no `SamplerEngine`. |
| Tauri mutex map | **Confirmed** — `src-tauri/src/commands/sampler.rs` pattern. |
| `initSamplerEngine(..., 44100)` | **Confirmed** — `SamplerPanel.tsx`. |
| Stereo filter shared | **Confirmed** — `crates/daw-dsp/src/sampler/voice.rs` ~244–248 `self.filter.process_mono(left)` then `self.filter.process_mono(right)` on **one** `TptSvf`. |
| **Name collision** | **Confirmed** — separate `SamplerEngine` types: `crates/daw-dsp/src/sampler/engine.rs` vs `crates/daw-dsp/src/fermenter/sampler.rs` (different modules). |

### Pass 3 (2026-04-14) — DSP + UI spot-check

| Claim | Result |
|--------|--------|
| **`loop_crossfade` unused in advance** | **Confirmed** — `advance_position` (`voice.rs` ~282–322) never reads `self.loop_crossfade`; field is only stored (~121). Forward loop snaps `position = start + overshoot` (~299–303). |
| **`playbackFrame` + `subscribeToPosition`** | **Confirmed** — `SamplerPanel.tsx` ~104–108 `useState` + `subscribeToPosition(setPlaybackFrame)`. |
| **`PadGrid` without `padPeaks`** | **Confirmed** — `SamplerPanel.tsx` ~190–196 `<PadGrid ...>` passes pads/select/onTrigger only; **no** `padPeaks` prop. |
| **`smartLoopPoints` IPC fan-out** | **Refined** — `detectAndApplyLoopPoints` (`smartLoopPoints.ts`) calls **`setSamplerParamThrottled` four times** (loopMode, loopStart, loopEnd, loopCrossfade) after `setLoopParams`; audit “four calls” claim **holds** for the param bridge path. |

### Gaps
- End-to-end test once sampler is wired: playback + multi-instance stores.
- Runtime heap proof for Tauri `SamplerEngine` mutex contention (still analytical until graph integration exists).

### Pass 4 (2026-04-14) — scheduler cross-check

| Claim | Result |
|--------|--------|
| **`SamplerEngine` still absent from `daw-engine` graph** | **Re-confirmed** — `rg SamplerEngine` / `sampler` on `crates/daw-engine/src/scheduler.rs` finds **no** `SamplerEngine` integration; only `PluginCore::Knead` path among builtins (~74–91 area). Matches Pass 2/3. |