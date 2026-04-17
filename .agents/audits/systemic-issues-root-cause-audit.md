# Comprehensive Systemic Issues Root-Cause Audit

## 1. Executive Summary

This audit investigates a wide array of 20 distinct reported issues encompassing application warnings, playback regressions, editor interaction bugs, state synchronisation failures, and DSP initialisation errors. Several recurring themes suggest systemic architectural drift rather than isolated bugs:
- **Environment Discrepancies:** Multiple errors (Tauri bridge "invoke" undefined, WebLLM model constraints, SharedArrayBuffer headers) point to a fragmented runtime environment where platform capabilities are assumed rather than feature-detected or correctly mocked.
- **Stale State and Lifecycle Leaks:** Issues with duplicate action handlers, persistent plugin panels across track switches, and faders that only sync on mouse-up indicate a breakdown in React lifecycle teardown and controlled/uncontrolled state boundaries.
- **Coordinate Space and Interaction Regression:** Issues affecting MIDI editor interactions (context menus far from cursor, lasso/rectangle selection missing notes, chord helper non-expandable notes) point to coordinate-transform bugs or stale bounding box caches on zoom/scroll.
- **Transport/Timeline and Clip Model Drift:** The MIDI clip bound to playhead post-recording, timeline zoom brokenness, and delay tempo-sync feature gaps reveal incomplete finalisation protocols in transport state and the clip recording lifecycle.

By treating these symptoms systematically, we can target the common root causes—such as enforcing proper component unmounting, standardising Tauri API checks, and unifying coordinate mapping in the editor—to resolve multiple items simultaneously.

---

## 2. Issue Inventory Grouped by Subsystem

| Issue | Symptom | Likely Subsystem | Potential Shared Cause |
| --- | --- | --- | --- |
| 1. Duplicate action handler warnings | `[DEV][WARN] [executeAppAction] Duplicate handler for action type...` | State-management, Plugin lifecycle | Missing lifecycle cleanup/teardown |
| 2. WebLLM model mismatch | `UnsupportedModelIdError: Qwen3-4B-q4f16_1-MLC is not supported...` | Backend invocation, State-management | Outdated feature path / fallback |
| 3. Sampler position poll failure | `TypeError: Cannot read properties of undefined (reading 'invoke')` | Backend invocation, Transport | Missing capability checks, Web/Tauri mismatch |
| 4. SharedArrayBuffer / CORS failures | `[WebAudioEngine] Grand Boule failed: Error: SharedArrayBuffer...` | WebAssembly, Audio engine | Environment mismatch, Missing fallback |
| 5. KneadEditor pitch analysis | `Real DSP pitch analysis is not wired up yet for track...` | WebAssembly, Audio engine | Incomplete implementation / stub |
| 6. "Improve the templates" | Standalone note | UI, Asset-loading | Underspecified feature/UX |
| 7. MIDI clip cut by playhead | Clip tethered to playhead after recording, disappears if restarted | Transport, MIDI model | Recording finalisation broken |
| 8. Spacebar does not play song | Spacebar transport binding fails | Keyboard shortcut, Transport | Focus trap, Broken command routing |
| 9. Plugin bottom panels persist | Open panels stay open when switching tracks | State-management, Plugin lifecycle | Stale/globalised UI state |
| 10. Delay timing tempo snapping | Need delay option to snap time 1/1 to 1/64th | Audio engine, UI | DSP/UI capability gap |
| 11. Chord helper notes non-expandable | Added 3 notes are not expandable, selection has no effect | MIDI model, UI | Invalid transient note structure |
| 12. MIDI lasso/ghost notes broken | Lasso misses, no rectangle drag, ghost notes toggle broken | MIDI model, Rendering | UI coordinate transform bugs |
| 13. Context menu far from cursor | Right-click menu appears far below/right | Layout, Coordinate-space | UI coordinate transform bugs |
| 14. Faders snap on release | Dragging fader unresponsive, snaps on mouse up | UI, State-management | Stale UI state, React controlled/uncontrolled |
| 15. TrackDevicesSection huge | Inspector UI shows all effects in huge menu | UI, Rendering | Missing component decomposition |
| 16. Timeline zoom/minimap broken | Cannot zoom, `cmd+` broken, minimap non-resizable | Keyboard shortcut, Layout | Broken command routing, State disconnect |
| 17. Levain plugin boot time | Ages to boot, `Failed to load sample... (404)` | Asset-loading, Plugin lifecycle | Asset pipeline / serial fetches |
| 18. Multi-track selection missing | Cannot select multiple tracks | State-management, UI | Missing interaction model |
| 19. Crust/Gluten/Proof no audio | No noticeable difference in sound, SharedArrayBuffer errors (original report wrote "Curst"; the plugin in the code is **Crust**) | Audio engine, Plugin lifecycle | Incomplete plugin fallback / SAB error cascade / missing DSP impl |
| 20. Pro parametric EQ broken | Vis not interactive, knobs do nothing | Audio engine, UI | Parameter changes not reaching DSP graph |

---

## 3. Detailed Root-Cause Investigation Notes Per Issue

### 1) Duplicate action handler warnings
- **Symptom:** `[DEV][WARN] [executeAppAction] Duplicate handler for action type: audioToMidi`, `stripSilence`, `detectKey`, `detectTempo`
- **Subsystem:** state-management-related, UI event-handling-related, plugin lifecycle-related
- **Regression Surface:** Action registry module, Hot-module reloading (HMR) teardown, Component unmount effects.
- **Hypotheses:** Handlers are registered on remount, hot reload, or module boot without corresponding teardown logic in `useEffect` cleanup or global registry unsubscribe. Action registry might be global when it should be strictly scoped to the document/project.
- **Code to Inspect:** `executeAppAction` implementation, modules registering `audioToMidi`/`stripSilence`, top-level Provider/Context teardowns.
- **Instrumentation:** Log stack traces inside the handler registration function to identify the caller and verify whether unmount/cleanup logic is ever reached.

### 2) WebLLM model mismatch for add MIDI completion feature
- **Symptom:** `[DEV][WARN] [WebLLM] Tool call API failed: UnsupportedModelIdError: Qwen3-4B-q4f16_1-MLC is not supported for ChatCompletionRequest.tools...`
- **Constraint:** Do not use WebLLM for add MIDI completion unless using the current setup with Qwen.
- **Subsystem:** Tauri bridge / backend invocation-related
- **Regression Surface:** AI/LLM tool calling bridge, Action parsing.
- **Hypotheses:** The code expects to use a tool-calling API (`ChatCompletionRequest.tools`) that Qwen3-4B-q4f16_1-MLC does not support. An outdated feature path is being invoked instead of a supported standard completion prompt or a fallback.
- **Code to Inspect:** LLM client wrapper, MIDI completion prompt generation, model capability detection mappings.
- **Instrumentation:** Log the payload being sent to the LLM backend to confirm if `tools` array is attached improperly.

### 3) Sampler position poll failure / Tauri bridge invocation issue
- **Symptom:** `[DEV][WARN] Sampler position poll failed: TypeError: Cannot read properties of undefined (reading 'invoke')`
- **Subsystem:** Tauri bridge / backend invocation-related, audio engine / DSP-related, transport / timeline-related
- **Regression Surface:** Sampler polling loop, Tauri IPC initialization.
- **Hypotheses:** The polling loop for the sampler is running in an environment where `window.__TAURI__` (or the equivalent bridge object) is undefined, such as a web-only build or before the bridge is fully injected. The polling loop lacks a capability check.
- **Code to Inspect:** `tauriBridge` IPC wrappers, Sampler component `useEffect` that triggers polling, Tauri initialization guards.
- **Instrumentation:** Add assertions for `window.__TAURI__.invoke` existence before initiating the setInterval/requestAnimationFrame poll.

### 4) SharedArrayBuffer / cross-origin isolation failures
- **Symptom:** `[WebAudioEngine] Grand Boule failed: Error: SharedArrayBuffer is not available. The server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers.`, plus `ReferenceError: SharedArrayBuffer is not defined` for Gluten and Proof.
- **Subsystem:** WebAssembly / worker / SharedArrayBuffer-related, audio engine / DSP-related, plugin lifecycle-related
- **Regression Surface:** Dev server configuration, AudioWorklet message passing, WASM memory initialization.
- **Hypotheses:** The development server or Tauri webview is not serving the required COOP/COEP headers. Certain plugins mandate SAB for IPC/WASM memory but fail to gracefully degrade or bypass when SAB is unavailable.
- **Code to Inspect:** Vite dev server config (`vite.config.ts`), Tauri webview header configuration, `Grand Boule`, `Gluten`, and `Proof` initialization sequences.
- **Instrumentation:** `console.log(typeof SharedArrayBuffer)` at bootstrap; add conditional compilation/fallback paths.

### 5) KneadEditor pitch analysis pipeline not connected
- **Symptom:** `[DEV][WARN] [KneadEditor] Real DSP pitch analysis is not wired up yet for track track-c76c73f6; blob list will remain empty until the WASM pitch pipeline is connected.`
- **Subsystem:** WebAssembly / worker / SharedArrayBuffer-related, audio engine / DSP-related
- **Regression Surface:** KneadEditor feature flags, WASM DSP pipeline.
- **Hypotheses:** This is a planned but incomplete feature (a stub). The UI is exposed to users, but the backend WASM pitch pipeline has not been connected to the track's audio graph.
- **Code to Inspect:** `KneadEditor` component, Pitch extraction WASM module bindings.
- **Instrumentation:** Trace where the stub is generated and determine if a mock data stream can be injected until the real DSP is ready, or if the feature should be hidden behind a flag.

### 6) “Improve the templates”
- **Symptom:** Standalone note `Improve the templates`.
- **Subsystem:** Asset-loading-related, state-management-related
- **Regression Surface:** Project creation, track preset loading, or MIDI generator templates.
- **Hypotheses:** Refers to structural scaffolding (e.g., project starter templates, plugin chain presets, or UI boilerplate).
- **Code to Inspect:** Directory structures for project templates, JSON preset files.
- **Actionable path:** Identify the primary "template" concepts in the codebase (Project vs Track vs Plugin) and clarify this requirement with design.

### 7) MIDI clip gets cut by playhead after recording
- **Symptom:** After recording, changing the playhead cuts the MIDI clip. If restarted, it disappears. Clip cannot be moved/stretched.
- **Subsystem:** transport / timeline-related, MIDI model / clip model-related, state-management-related
- **Regression Surface:** Recording stop logic, Clip state transitions (transient -> committed).
- **Hypotheses:** The clip remains in a "live recording" transient state after the transport stops. The `endTime` property is still dynamically bound to the playhead position instead of being committed as a static timestamp.
- **Code to Inspect:** Transport `stop` action, Record toggle logic, MIDI clip state reducers.
- **Instrumentation:** Log the `clip.isRecording` or `clip.state` property on transport pause/stop.
- **Reproduction Steps:** Start recording -> play MIDI notes -> Stop transport -> Move playhead.

### 8) Spacebar does not play the song
- **Symptom:** Pressing space is not playing the song.
- **Subsystem:** keyboard shortcut / focus-related, UI event-handling-related
- **Regression Surface:** Global keyboard event listeners, command router, focus management.
- **Hypotheses:** A focus trap inside an input or editor prevents the event from bubbling up, or a global keydown listener was removed. Browser default behaviors (like scrolling) might be interfering if `preventDefault` is missing.
- **Code to Inspect:** Global keyboard shortcut registry (e.g., `useKeyboardShortcuts`), Spacebar command handler, focus managers.
- **Instrumentation:** Add a global `window.addEventListener('keydown', console.log)` to see if the event fires and what the `document.activeElement` is.

### 9) Plugin bottom panels should close when switching tracks
- **Symptom:** When switching to a new track, previously open plugin bottom panels should be closed.
- **Subsystem:** state-management-related, plugin lifecycle-related
- **Regression Surface:** UI state synchronisation, Track selection reducers.
- **Hypotheses:** The UI state governing "active bottom panel" is stored globally and independently of the "active track" state. It does not reset when track selection changes.
- **Code to Inspect:** Track selection action dispatcher, Bottom panel visibility store/context.
- **Instrumentation:** Watch the bottom panel visibility state when a `SELECT_TRACK` action is dispatched.

### 10) Delay timing should support tempo snapping from 1/1 to 1/64
- **Symptom:** Delays need an option to snap time to tempo from `1/1` to `1/64th`.
- **Subsystem:** audio engine / DSP-related, UI event-handling-related
- **Regression Surface:** Delay parameter definitions, BPM synchronisation logic.
- **Hypotheses:** Delay parameters are currently hardcoded to raw milliseconds/seconds. Tempo sync support requires a UI toggle (Sync vs Free) and DSP parameter calculation based on current global BPM.
- **Code to Inspect:** Delay plugin AudioWorklet/WASM parameters, standard Delay UI component, Transport BPM state.
- **Actionable Path:** Introduce a standard note-division Enum and a UI toggle for "Tempo Sync" on all delay-based effects.

### 11) MIDI editor chord helper notes cannot be expanded or manipulated properly
- **Symptom:** Notes added via the chord helper (3 notes at once) are non-expandable and unselectable.
- **Subsystem:** MIDI model / clip model-related, UI event-handling-related
- **Regression Surface:** Chord generation logic, Note entity schema.
- **Hypotheses:** The chord helper creates notes that are missing standard identifiers (IDs), bounds, or selection handlers. They might be rendered as grouped transient entities rather than individually instanced note entities.
- **Code to Inspect:** `ChordHelper` insertion function, Note renderer hit-test logic, Note selection reducers.
- **Instrumentation:** Compare the JSON payload of a manually drawn note versus a chord helper generated note.

### 12) MIDI editor lasso selection, rectangle selection, and ghost notes issues
- **Symptom:** Lasso misses notes, rectangle drag selection unavailable, ghost notes toggle broken.
- **Subsystem:** MIDI model / clip model-related, rendering-related, layout / coordinate-space-related
- **Regression Surface:** Piano roll interaction layer, Canvas/SVG hit-testing.
- **Hypotheses:**
  1. Lasso/Rectangle hit-testing is failing due to zoom scaling or incorrect screen-to-local coordinate mappings.
  2. Rectangle drag was partially implemented but never bound to mouse events.
  3. Ghost notes visibility state is disconnected from the render loop.
- **Code to Inspect:** PianoRoll mouse event handlers (`onMouseDown`, `onMouseMove`), Selection boundary intersection math, Ghost note rendering conditional logic.
- **Instrumentation:** Log the bounding box of the lasso and the bounds of the note during an intersection test.

### 13) MIDI editor context menu appears far from cursor
- **Symptom:** Right-click context menu appears far below and to the right.
- **Subsystem:** layout / coordinate-space-related, UI event-handling-related
- **Regression Surface:** Context menu positioning logic.
- **Hypotheses:** The `clientX`/`clientY` from the mouse event is being mapped directly to the menu's absolute position without compensating for scroll offsets, parent container relative positioning, or zoom scale.
- **Code to Inspect:** Context menu `onContextMenu` handler, CSS positioning of the context menu portal.
- **Instrumentation:** Log `e.clientX`, `e.pageX`, and `container.getBoundingClientRect()` at the time of click.

### 14) Faders move incorrectly and snap only on mouse release
- **Symptom:** Dragging faders doesn't respond; they snap into position on mouse release.
- **Subsystem:** UI event-handling-related, state-management-related, rendering-related
- **Regression Surface:** Fader/Slider components, React state updates.
- **Hypotheses:** The fader is bound to an asynchronous or debounced global state update instead of a fast local UI state during the drag. It operates as an uncontrolled component during drag, or render feedback is blocked by expensive memoization until `mouseUp` commits the value.
- **Code to Inspect:** Fader component `onChange` vs `onMouseUp` handlers, Global state dispatch during dragging.
- **Instrumentation:** Track if `onChange` is firing continuously during drag, and if the Fader's `value` prop is reflecting the change immediately.

### 15) `TrackDevicesSection.tsx` inspector UI needs reorganization
- **Symptom:** Shows all effects in a huge menu; needs navigation/collapsible layout.
- **Subsystem:** UI event-handling-related, rendering-related
- **Regression Surface:** Inspector layout components.
- **Hypotheses:** The component iterates over all available devices and renders them in a flat list. It violates basic information architecture for dense editors.
- **Code to Inspect:** `TrackDevicesSection.tsx`
- **Actionable Path:** Decompose into categorized accordions (e.g., Instruments, EQs, Dynamics, Delays/Reverbs) and add a search filter.

### 16) Timeline zoom and minimap resizing are broken/missing
- **Symptom:** Cannot zoom timeline, `cmd+` shortcut broken, minimap non-resizable.
- **Subsystem:** keyboard shortcut / focus-related, layout / coordinate-space-related, transport / timeline-related
- **Regression Surface:** Timeline zoom state, Keyboard shortcuts, Minimap interaction handlers.
- **Hypotheses:** Shortcut bindings were removed or shadowed by global browser zoom. The timeline minimap relies on generic resize logic that was decoupled from the timeline viewport zoom state.
- **Code to Inspect:** Timeline keyboard shortcut registrations, Minimap drag handlers, Zoom scale reducers.
- **Instrumentation:** Verify if `cmd+` triggers browser zoom or app zoom.

### 17) Levain plugin takes too long to boot
- **Symptom:** Takes ages to boot up; `Failed to load sample Oboe_Sus_A#4_v1_Main.wav (404)`.
- **Subsystem:** asset-loading-related, plugin lifecycle-related
- **Regression Surface:** Sample fetching loop, Plugin boot sequence.
- **Hypotheses:** The boot sequence blocks on serial sample fetching, or retries repeatedly on 404s. The `#` character in the sample filename might be improperly URL-encoded, causing the 404 and subsequent fallback delays.
- **Code to Inspect:** Levain initialization logic, `fetchSample` utility, URL encoding for sample paths.
- **Instrumentation:** Network tab timing for sample requests. Fix URL encoding for `#` (`%23`).

### 18) No multi-track selection support
- **Symptom:** No way to select multiple tracks at the same time (e.g., to delete 5 tracks).
- **Subsystem:** state-management-related, UI event-handling-related
- **Regression Surface:** Track selection store, Track list interaction.
- **Hypotheses:** The system currently relies on a singular `activeTrackId` string rather than a `selectedTrackIds` array or `Set`.
- **Code to Inspect:** Workspace state (tracks slice), Track header click handlers (Shift/Cmd click).
- **Actionable Path:** Refactor single-selection state to a Set of IDs, update all downstream consumers (Inspector, Piano Roll, Deletion commands).

### 19) Crust, Gluten, and Proof produce no audible effect
- **Symptom:** No noticeable difference in sound. Associated with SharedArrayBuffer errors for Gluten/Proof.
- **Subsystem:** WebAssembly / worker / SharedArrayBuffer-related, audio engine / DSP-related, plugin lifecycle-related
- **Regression Surface:** Plugin DSP initialization, Audio graph routing.
- **Hypotheses:** The DSP nodes fail to initialize (due to SAB missing, see #4) and silently bypass the audio graph to prevent crashes, but UI indicates they are active. Alternatively, wet/dry mix defaults to 0%.
- **Code to Inspect:** Audio engine node connections, `Gluten`/`Proof` WASM wrappers, Crust device-strategy registration (see §8.19 — it has no engine-side implementation), Error boundaries for AudioWorklets.
- **Instrumentation:** Inspect the active AudioContext graph to see if the nodes are inserted and processing.

### 20) Pro parametric EQ appears completely non-functional
- **Symptom:** Vis not interactive, knobs do nothing.
- **Subsystem:** audio engine / DSP-related, UI event-handling-related
- **Regression Surface:** EQ parameter wiring, Analyser node visualization.
- **Hypotheses:** The UI component state is entirely decoupled from the actual WebAudio BiquadFilter / AudioWorklet parameters. The visualization lacks a connection to an AnalyserNode on the track.
- **Code to Inspect:** ProEQ React component, Audio engine EQ node parameter update bridge.
- **Instrumentation:** Verify that knob `onChange` dispatches an event that successfully reaches the DSP node parameter setters.

---

## 4. Cross-Issue Pattern Analysis

1. **Broken Lifecycle / Teardown Leaks**
   - *Issues:* #1 (Duplicate handlers), #9 (Plugin panels persist)
   - *Cause:* React `useEffect` cleanup functions are missing or global registries aren't flushed on component unmount/re-render.
2. **Environment & Capability Mismatches**
   - *Issues:* #2 (WebLLM Qwen tool support), #3 (Tauri `invoke` undefined), #4 (SharedArrayBuffer CORS)
   - *Cause:* Code executes blindly assuming Web or Tauri context, or assuming ideal browser headers. Missing explicit capability detection (`typeof SharedArrayBuffer !== 'undefined'`).
3. **Coordinate Space and Interaction Drift**
   - *Issues:* #12 (Lasso misses), #13 (Menu far from cursor), #16 (Zoom/Minimap broken)
   - *Cause:* A failure to centralize screen-to-local coordinate transformations, especially under zoomed or scrolled container conditions.
4. **Decoupled Transient UI State vs DSP/Engine State**
   - *Issues:* #14 (Faders snap on release), #20 (Pro EQ knobs do nothing), #19 (Plugins do nothing silently), #7 (MIDI clip recording state)
   - *Cause:* The flow of data between fast local UI interactions and the authoritative backend (Rust/WASM/AudioEngine/Transport) is broken. Errors in the engine are not surfaced to the UI (e.g. SAB failures cause silent audio bypass), and local UI drags are blocked from continuous dispatch.

---

## 5. Prioritized Remediation Plan

1. **P0 - Architectural & Correctness Fixes (High Impact)**
   - Fix SharedArrayBuffer headers / Fallbacks (Issues #4, #19). Without this, major DSP features are completely dead.
   - Fix Tauri `invoke` polling and WebLLM capability checks (Issues #3, #2). Prevent unhandled exceptions from spamming the event loop and blocking other operations.
   - Fix Transport and Playhead boundaries (Issue #7). Core MIDI recording is fundamentally broken if clips disappear.

2. **P1 - Interaction & Coordinate Space (Medium-High Impact)**
   - Fix Keyboard Shortcut routing (Issue #8). Spacebar playback is critical path.
   - Audit and fix coordinate space math for the MIDI Editor (Issues #12, #13).
   - Fix Fader update loops (Issue #14) so the mixer and parameters feel responsive.

3. **P2 - Component Teardown & UI State Management (Medium Impact)**
   - Fix Duplicate Handlers (Issue #1) and Track Panel teardown (Issue #9) by implementing rigorous React lifecycle cleanup.
   - Investigate Levain boot time and URL encode the `#` character in sample fetches (Issue #17).
   - Fix Chord Helper transient note structures so they adhere to standard clip entity schemas (Issue #11).

4. **P3 - Features & UX Improvements**
   - Implement Multi-track selection state (Issue #18).
   - Reorganize Inspector UI `TrackDevicesSection` (Issue #15).
   - Implement Tempo Sync toggles for Delays (Issue #10).
   - Clarify and implement "Improve the templates" (Issue #6).

---

## 6. Recommended Instrumentation Additions

- **Tauri / Web Environment Guard:** Implement a global capability logger on boot that explicitly logs: `Tauri Context: boolean`, `SharedArrayBuffer: boolean`, `Cross-Origin Isolated: boolean`.
- **Action Dispatch Trace:** Add debug logging to `executeAppAction` indicating when a handler is registered and unregistered to track leaks.
- **Audio Graph Integrity Checks:** Add a debug panel or console warning when an effect node is instantiated but bypassed due to an internal initialization failure (like SAB missing).
- **Coordinate Hit-Test Debugger:** Add a debug flag to draw bounding boxes for lasso/rectangle selection intersections in the MIDI editor overlay to visually debug coordinate drift.

---

## 7. Open Questions / Unknowns Blocking Diagnosis

- **SharedArrayBuffer Intent:** Are the `Gluten`, `Proof`, and `Grand Boule` plugins fundamentally designed to *require* SharedArrayBuffer for threading/performance, or is there a fallback `postMessage` implementation available in their WASM builds?
- **WebLLM Architecture:** What is the intended role of the WebLLM in the "add MIDI completion" feature given that the current Qwen model does not support tool calling? Does the product requirement dictate parsing plain-text output, or migrating back to a tool-supported model?
- **"Improve the templates":** Needs product definition. What templates? Where?
- **WASM Pitch Pipeline:** For the KneadEditor (Issue #5), does the WASM pitch extraction pipeline exist and simply need UI wiring, or is the DSP work completely unwritten?

---

## 8. Validated Root-Cause Analysis (Code-Level Findings)

> This section captures the result of an end-to-end code investigation of every item in §2 against the current `main`. For each issue it records **Status** (`CONFIRMED` / `PARTIALLY CONFIRMED` / `REFUTED` / `STALE`), the precise file/line references, the minimal reproduction chain, the true root cause, and a fix direction. Any hypothesis from §3 that the code does not support is explicitly refuted.

### 8.2 — WebLLM `UnsupportedModelIdError` on Qwen3 (§3.2) — **OPEN — surveillance only**

- **Call-site audit:** Every `tools:` literal in `src/` was inspected. `src/modules/AiRuntime/repositories/webLlm/toolCalling.ts` routes around the unsupported API via `parseToolCallXml`. `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/generateCloudToolCalls.ts` sends `tools:` only to cloud backends. No MLC-bound call site attaches `tools:` today, so the warning originates inside a third-party dependency or a stale build.
- **Capability gate:** `src/utils/capabilities.ts` exposes `supportsToolsApi(modelId)` with an explicit allow-list (empty for MLC models). Any future WebLLM call site considering the native `tools` path must gate behind that helper.
- **Surveillance:** `generateWebLlmCompletion` logs `[WebLLM] completion model=<id> keys=<sorted payload keys>` on every invocation (payload contents intentionally **not** logged — token cost). If the error recurs, the preceding log line names the model and shows whether `tools` is in the payload keys.
- **Close criteria:** if logs over a representative usage window never contain `tools` in `keys=`, the original audit entry is a stale build artifact and can be closed. If they do, the call site is inside WebLLM itself and the fix becomes a dependency pin or patch.

### 8.4 — SharedArrayBuffer / CORS errors (§3.4) — **CONFIRMED (plus mis-named culprit)**

- **Evidence:**
  - `vite.config.ts:25-28` and `:84-87` set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for `server` and `preview`. So in dev the browser *should* get SAB.
  - `src/modules/AudioEngine/engine/GrandBouleNode.ts:84-90` hard-throws when `typeof SharedArrayBuffer === 'undefined'`.
  - `src/modules/AudioEngine/engine/telemetryAllocator.ts:112-119` lazily allocates a single SAB used by `GlutenNode` (`:55-59`) and `ProofNode` for telemetry. Without SAB, allocator fails, cascading into node construction errors — same symptom class as Grand Boule.
- **Reasons the error persists in practice:**
  1. **Stale build cache:** Vite sometimes serves a cached `index.html` without headers after config change. Kill and restart dev server after editing `vite.config.ts`.
  2. **Tauri webview:** `src-tauri/tauri.conf.json` may not mirror the COOP/COEP headers (unverified — checking is a blocker; see §8.21). The Tauri webview serves assets through a custom protocol and does not automatically inherit Vite dev headers.
  3. **Cross-origin embedded resources:** COEP `require-corp` refuses any embedded subresource without a matching `Cross-Origin-Resource-Policy` header. WASM and sample fetches served from the same origin are fine; any third-party CDN (e.g. WebLLM model shards) would trip this.
- **Fix direction:**
  1. Add a boot-time capability probe at `AppShell` mount: `console.log('sab', typeof SharedArrayBuffer !== 'undefined', 'isolated', window.crossOriginIsolated)` and raise a visible in-app banner if `crossOriginIsolated === false`.
  2. Gate Grand Boule / Gluten / Proof instantiation behind `crossOriginIsolated` and surface a dismissible "requires COOP/COEP" error to the user instead of a silent throw.
  3. Verify and (if missing) mirror COOP/COEP in `src-tauri/tauri.conf.json` under `app.security.headers`.
  4. For WebLLM: ensure model shards come from the same origin or use CORP-enabled hosting.

### 8.6 — "Improve the templates" (§3.6) — **UNCHANGED**

- Pure product note. No code evidence to gather. Requires a product decision: project-level vs. track-preset vs. plugin-patch templates. Surface at next triage; do not block engineering on it.

### 8.7 — MIDI clip cut by playhead after recording (§3.7) — **RESOLVED**

- **Single source of truth.** `activeRecordingRef.current` in `src/modules/Arrangement/stores/activeRecordingRef.ts` is now the only store that tracks "which clips are actively being recorded". The previous mirrors — `activeRecordingClipIds` in `src/modules/Transport/useCases/transportControls/toggleRecording.ts` and `punchRecordingClipIds` in `src/modules/Transport/useCases/playheadScheduler.ts` — have been deleted. Only `startRecording` writes to the ref; only `stopRecording` clears it.
- **Parameterless stop contract.** `src/modules/Arrangement/useCases/recording/stopRecording.ts` takes no arguments: it reads `activeRecordingRef.current`, clears it immediately, and finalises every clip whose ID is in the snapshot. Every stop path in Transport (record button, transport stop, spacebar, escape, punch-out) calls `stopRecording()` with no clip-ID argument, so drift between "what Transport thinks is recording" and "what Arrangement is finalising" is structurally impossible.
- **Drift invariant.** `buildTimelineRenderModel` runs a one-shot guard per rAF episode: if `transportStore.isRecording === false` but `activeRecordingRef.current.length > 0`, it emits a single `logger.warn` line (`[recording] drift detected — transportStore.isRecording=false but activeRecordingRef has N clip(s)`). The latch resets whenever the ref drains, so a genuine future drift is still reported.

### 8.8 — Spacebar does not play (§3.8) — **RESOLVED (permanent unification landed)**

- **Permanent fix landed.** The parallel Workspace shortcut stack has been deleted — `Workspace/models/Shortcuts.ts`, `Workspace/useCases/shortcutEngine.ts`, `Workspace/useCases/lintShortcutCollisions.ts`, `Workspace/presentations/hooks/useAppKeyboardShortcuts.ts` and their tests no longer exist. Every global keydown now flows through a single chokepoint: `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts` → `handleKeydown` → `Command/stores/shortcutStore.ts`. `AppShell.tsx` mounts exactly one keydown listener; the `defaultPrevented` short-circuit is no longer needed and was removed together with the engine.
- **Store is the single source of truth.** `src/modules/Command/stores/shortcutStore.ts` now defines every previously-scattered binding as `ShortcutDefinition` rows: `transport.togglePlayback` (Space), `transport.stopPlayback` (Escape/Enter), `transport.toggleMetronome` / `toggleRecording` / `toggleLoop`, `arrangement.addMidiTrack` / `addAudioTrack`, `editing.undo` / `redo` / `copyClip` / `cutClip` / `pasteClip` / `deleteSelection`, `project.saveProject` / `openExportDialog` / `openPreferencesDialog`, `workspace.toggleSidebar` / `toggleInspector` / `toggleMixer` / `toggleChatPanel` / `toggleTrackList` / `toggleVirtualKeyboard` / `showAutomationPanel`. `handleKeydown.ts` dispatches them either as `AppAction`s (for undo/macro-traceable actions) or as direct callbacks (UI toggles, dialog openers, `deleteSelectionShortcut` for the multi-branch time-range-vs-clip delete).
- **Conflict resolution.** `workspace.clearClipSelection` kept `Escape` only; `mod+shift+a` now exclusively triggers `workspace.showAutomationPanel`. All other previous collisions (Space / Cmd+D / Cmd+K / Cmd+C / Cmd+V / Cmd+S / Backspace) resolve to a single definition.
- **Preferences UI migrated.** `src/modules/Workspace/presentations/views/ShortcutsSection.tsx` now reads and writes `shortcutStore.customMappings` directly, grouping by `ShortcutDefinition.category` and formatting combos from the store's canonical `modifier+key` strings. The old `Workspace/models/Shortcuts.ts` editor path is gone.
- **Verification.** `pnpm typecheck` clean. `pnpm deps:validate` 0 errors (pre-existing warnings only). Targeted unit tests pass (`ShortcutsSection.spec.tsx`, `AppShell.spec.tsx`, `handleKeyboardShortcut.spec.ts`, `executeAppAction.spec.ts`, `CaptureKeyButton.spec.tsx`). Broader `Command + Workspace + Proof` suite has 6 pre-existing failures unrelated to this refactor (confirmed via `git stash` replay on main): `ClipMidiAiSection.spec.tsx` (undefined `clip` prop, not a shortcut issue) and `devicePanels.spec.ts` (mismatched `eventBus.emit` payload shape, pre-existing).

### 8.9 — Plugin panels persist on track switch (§3.9) — **RESOLVED**

- **Scoping invariant landed.** `src/modules/Workspace/presentations/hooks/useActiveDevicePanel.ts` now captures the owning `trackId` on every panel open (`{ kind, deviceId, trackId: string | null }`) and subscribes directly to `trackStore`. When the current selection no longer matches the captured `trackId`, the panel closes. This catches any path that mutates `selectedTrackId`, including paths that bypass `selectTrack` — the previous `track.selectionChanged` event path is no longer a single point of failure.
- **Panels opened without a selected track** (e.g. Levain opened from the sidebar instruments browser, `trackId === null`) stay open across selection changes, matching the existing "global" opening semantics.
- **Carry-over event.** The `track.selectionChanged` event from `selectTrack` remains as a broadcast signal for any other consumer that cares about selection transitions; the panel hook no longer depends on it for correctness.

### 8.10 — Delay tempo-sync (§3.10) — **UNCHANGED (feature gap)**

- Confirmed as a genuine feature gap — no code exists for note-division sync in `src/modules/AudioEngine/repositories/devices/reverbDelay/`. Requires product scope + DSP parameter design. Not a regression; no root-cause remediation applies.

### 8.11 — Chord helper notes cannot be expanded (§3.11) — **SCOPE CLARIFIED — parked for spec**

- **Invalidated claims:** a careful re-read of `usePianoRollInteractions.ts` and `usePianoRollRenderer.ts` refutes the hypotheses in the initial audit:
  - "Chord-mode click on existing note creates another chord" — `hitTest` runs before the chord-mode branch in `handleMouseDown`; if the click lands on a visible note, the `if (hit)` branch routes into select/move/resize regardless of chord-mode state. The chord-mode stamp only fires on empty-area clicks. Not a bug.
  - "Notes are drawn faded but not hit-testable" — the renderer's `drawActiveNotes` loop does `if (row === -1) continue;` (see `usePianoRollRenderer.ts:537-540`). Off-scale notes under fold are **hidden entirely**, not faded. The user cannot click something they cannot see, so the hit-test filter is not the bug.
- **Real remaining bug:** when fold/scale-lock is active, off-scale chord helper notes (the 3rd and 5th that fall outside the current scale) disappear from both the renderer and the hit-test. The user can't select, move, or resize them without first toggling fold off.
- **Why this cannot ship as a quick win:** the fix couples rendering and coordinate space. Options:
  1. Include every pitch that has a note in the visible-pitch set — rendering, hit-testing, keyboard sidebar, and row ruler all derive off the same set. Keyboard needs a visual indicator that some rows are "off-scale, present because of notes".
  2. Render off-scale notes at the nearest scale row with an off-scale glyph — preserves compact fold but loses pitch fidelity.
  3. Disable fold automatically whenever an off-scale note exists. Aggressive but simple.
  Any of these is a multi-file, UX-reviewed change. Parked under the §14 / G1 coordinate spec as a linked decision — resolve the coordinate convention and the fold contract together.

### 8.12 — Lasso / rectangle selection (§3.12) — **ONLY OFF-SCALE LASSO MISS REMAINS**

- **Center-point bug (landed).** `usePianoRollInteractions.ts` now extrudes each note to its bounding box and tests the four corners + center against the lasso polygon, plus a polygon-vertex-inside-note-rect fallback. Long notes whose center sat outside a tight lasso are now selected; a small lasso drawn inside a big note still selects the note.
- **Remaining (tied to §8.11):** off-scale notes under fold still have `visiblePitches.indexOf(note.pitch) === -1`, so they are skipped from the lasso loop even if the polygon encloses them. This is the same filter as the fold-rendering path — they aren't drawn either. Resolving this requires the fold-contract decision from §8.11, not a new lasso pass.

### 8.14 — Faders snap on release (§3.14) — **CONFIRMED — write-path storm**

- **Evidence chain per drag event:**
  1. Radix `Slider` emits `onValueChange` on every pointer-move (continuous).
  2. `src/modules/Workspace/presentations/views/Inspector/TrackLevelSection.tsx:39-47` calls `setTrackGain(track.id, v/100)` synchronously.
  3. `src/modules/Arrangement/useCases/setTrackGainPan/setTrackGain.ts:9-15` does four things per call:
     - `updateTrack(...)` → `trackStore.set(...)` → fans out to every subscribing view (Inspector, Mixer, TimelineSurface, automation lanes, etc.).
     - `engineSetTrackGain(...)` → Web Audio gain node write.
     - `syncToasterPadParam(...)` → additional device param write if Toaster is present.
     - `maybeRecordAutomation(...)` → automation point recording.
- **Why this looks like "snaps on release":** `trackStore.set(...)` triggers a re-render of every subscriber; some subscribers (TimelineSurface canvas redraw, mixer meters) can take >16 ms, long enough that the main thread misses subsequent pointermove events. The Slider's controlled value then lags, producing a stair-step visual where the thumb only catches up when pointer events cease and the store finally quiesces.
- **Fix direction — two options, not mutually exclusive:**
  1. **Split fast vs. commit path.** During drag, update a local ref + thumb position directly; only commit to `trackStore` on `onValueCommit` (Radix emits this on pointer-up). Engine writes can still be throttled via `requestAnimationFrame` so audio stays smooth.
  2. **Decouple rendering from store fanout.** Timeline and mixer meters should not subscribe to the full track object — they should subscribe to the specific fields they read (via selectors) and bail out on shallow-equal updates. This is a broader write-path audit item that affects faders, pan knobs, sends, and device params uniformly.
- This ties into the §4.4 pattern ("Decoupled Transient UI State vs DSP/Engine State") and should be solved systemically, not per-control.

### 8.15 — `TrackDevicesSection` menu huge (§3.15) — **UX SCOPE (not a regression)**

- **Evidence:** `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx` renders three categorised lists (`effect` / `utility` / `analyzer`) plus a flat `scannedPlugins` external list. No search filter, no accordion structure.
- **Fix direction:** Decompose into accordions by category, add a search input across all lists (user-installed and external), and virtualise the external list when it grows beyond a few dozen entries. UX scope — not a regression.

### 8.16 — Timeline zoom shortcut broken (§3.16) — **ZOOM RESOLVED; MINIMAP RESIZE RE-SCOPED AS FEATURE GAP**

- **Zoom key path:** resolved. `view.zoomIn` / `view.zoomOut` defaults are now `['mod+=', 'mod++', '=', '+']` / `['mod+-', '-']`; the `matches()` parser in `handleKeydown.ts` handles trailing `+` keys correctly; `handleKeydown` already returns `true` for zoom callbacks and `useGlobalKeyboardShortcuts` calls `e.preventDefault()` on that signal — browser zoom is beaten.
- **Minimap resizing:** re-scoped after code inspection. `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx` renders at a fixed `MINIMAP_HEIGHT = 28px` and exposes no drag-handle on any edge. The minimap's viewport rectangle is click-to-jump and drag-to-scroll only; there is no edge-resize affordance and no prefs key to change its height. This is **not a regression**, it is a missing feature. The container can be made resizable by adding a top-edge `DragResizeHandle` that writes to a new `preferencesStore` key (analogous to `mixerHeight`), but that is a product decision, not a bug fix. Record under feature-gap items (§10.3) if pursued.

### 8.17 — Levain (§3.17) — **ONE BUG OPEN**

- **Bug C (unreported — memory pressure):** The transferable-buffer path sends each decoded sample to the worklet with `postMessage([transferable])`, and the browser transfers ownership, which is great. But the same buffer is first held in `fetchAndDecode` — if the worklet processor is slow to acknowledge (no ack flow exists), the main thread can queue dozens of MBs of MessagePort backpressure. Consider ack-based flow control for large banks. Not a correctness bug but a hidden cause of "ages to boot" on slow machines.

### 8.18 — Multi-track selection missing (§3.18) — **CONFIRMED + recording bug**

- **Evidence (selection model):** `src/modules/Arrangement/stores/trackStore.ts:22-28` models selection as a singular `selectedTrackId: string | null`. No `selectedTrackIds: Set<string>`. Every consumer of track selection (Inspector, automation lanes, deletion commands) reads the single ID.
- **Secondary finding (MAJOR — multi-track *audio recording* is broken):** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:36-63` holds a single `recordingSession: RecordingSession` via `createHmrPersistentState`. There is exactly one `mediaStream`, one `sourceNode`, one `recordingNode`, and one `onRecordingComplete`. When `toggleRecording` loops over multiple armed audio tracks (`src/modules/Transport/useCases/transportControls/toggleRecording.ts:27-59`) and calls `startAudioRecording(trackId, ...)` once per track, **each successive call overwrites the previous session's state** — the previous track's `onRecordingComplete` is orphaned, its worker keeps filling a SAB that no one reads, and only the last-armed track actually produces a buffer on stop.
  - Note that §3.18 described this as "missing multi-track selection". The audio-recording failure is a separate, more severe consequence of the same single-selection assumption.
- **Fix direction:**
  1. Refactor track selection to `selectedTrackIds: string[]` (ordered) with `primarySelectedTrackId` derived (last click). Every consumer must migrate simultaneously — this is a bulk refactor best done under a proper spec.
  2. Refactor `recording.ts` to hold `recordingSessions: Map<trackId, RecordingSession>` so multiple tracks record into independent rings. Each `stopAudioRecording` stops its own session; a `stopAllAudioRecording` convenience exists for the common "stop everything" path.
  3. The §7 spec should treat these as two independently-landed milestones, with the recording fix gated on the new session map (not on the selection refactor).

### 8.19 — Gluten / Proof / Crust silent (§3.19) — **SAB-CONTRACT LANDED; CRUST IS A MISSING IMPLEMENTATION**

> **Typo correction (carried through §2, §3.19 and the issue table):** the original report wrote "Curst". The plugin's name in the codebase is **Crust** (`src/modules/Crust/...`, `CRUST_DESCRIPTOR`). References below use the correct name; the hypothesis that it was a routing/wet-dry bug in the same family as §8.20 is **wrong** and superseded by the evidence below.

- **Contract in place across every SAB-backed node.** `src/modules/AudioEngine/engine/pluginHostingErrors.ts` now exports `requireSharedArrayBuffer(pluginName)`; `GrandBouleNode`, `GlutenNode`, `ProofNode`, `GrinderNode`, `BacteriaNode`, and `ScoringNode` each call it as their first statement, so any SAB-missing failure surfaces as a typed `PluginRequiresIsolationError` with the plugin name. `buildDeviceChain` catches the type, routes audio around the missing node, and — when SAB is present but some other isolation prerequisite is not — fires a per-insert toast. When SAB is globally unavailable, the banner is the signal and the per-insert toast is suppressed to avoid spamming one message per device.
- **Capability banner landed.** `CapabilityBanner` renders at the top of `AppShell` whenever `!crossOriginIsolated || !SharedArrayBuffer`, is session-dismissible via `sessionStorage`, and lists the affected plugins by name. The per-insert toast from `buildDeviceChain` is gated on `hasSharedArrayBuffer()` to avoid redundant signal when the banner is up.
- **Crust — root cause is a missing DSP implementation, not a bug.** Searched the entire repo (`src/`, `src-tauri/`, `crates/`) for any engine-side Crust node, worklet, Faust module, or Rust crate — **none exists**. The Crust module ships a complete front-end stack (`src/modules/Crust/stores/`, `src/modules/Crust/useCases/crustParamBridge/`, `src/modules/Crust/presentations/`, presets, waveform display, metering strip, param batcher, panel open/close handlers), and `CRUST_DESCRIPTOR` (`src/modules/Arrangement/models/pluginDescriptors/crustDescriptor.ts`) is included in `BUILTIN_PLUGINS` with `id: 'crust'`, so the plugin is addable from the effects tab. On the engine side, two independent dispatch tables have to resolve the type: (a) `TrackNode.addDevice` (`src/modules/AudioEngine/engine/TrackNode.ts`) — consults `DEVICE_FACTORIES` for the `builtin-*` family then falls through to `findWasmDescriptor` (`src/modules/AudioEngine/engine/wasmDeviceRegistry.ts`); (b) `DeviceFactoryRegistry` in `setupDeviceStrategies.ts` — used by the offline render / rebuild path. `'crust'` matches **nothing** in either: it has no `builtin-` prefix (so skips `DEVICE_FACTORIES` and the `'builtin-'` strategy matcher), is absent from `wasmDeviceRegistry`'s matchers list (`isFermenterDevice` / `isToasterDevice` / `isLevainDevice` / `isGlutenDevice` / `isBacteriaDevice` / `isGrinderDevice` / `isProofDevice` / `isProofChamberDevice` / `isScoringDevice` / `isGrandBouleDevice` / `isFaustModule`), and is not a Faust module (no `registerPluginLoader('crust', …)` anywhere). The concrete sequence:
  1. `addDevice(trackId, 'crust')` (`src/modules/Arrangement/useCases/device/addDevice.ts`) finds the descriptor in `BUILTIN_PLUGINS`, appends `{ type: 'crust' }` to `track.devices`, then calls `addDeviceToStrip(trackId, deviceId, 'crust')`.
  2. `TrackNode.addDevice` reaches the `findWasmDescriptor('crust')` fallback, gets `undefined`, and hits the **unlogged** `return;` on `TrackNode.ts:282`. The device is never inserted into `strip.deviceNodes`.
  3. Every subsequent `updateDeviceParam(trackId, deviceId, ...)` from `setCrustParamWithAudio` targets a device that does not exist on the engine side.
  4. The offline-render path (`buildDeviceChain` → `deviceRegistry.createDevice`) would throw `No device factory registered for type: crust`, but that path is only hit during render/rebuild when the track has an active chain — and even then `buildDeviceChain`'s catch emits a single `logger.warn` that looks indistinguishable from a routine device load failure.
- **Impact:**
  - User adds Crust → device appears in the inspector, the panel opens, presets load, knobs move — but audio is bit-identical to no device inserted.
  - On the primary "add to live track" path there is **no log signal at all** (`TrackNode.ts:282` returns without logging). Only the offline-render path logs, and only as a generic warn.
- **Fix direction (not a single-session task — needs spec):**
  1. Decide the DSP backend for Crust: (a) Faust module alongside the other Faust effects, (b) Rust/WASM native node matching the pattern in `GlutenNode` / `ProofNode` / etc., or (c) pure Web Audio using `DynamicsCompressorNode` + `WaveShaperNode` + oversampling — each has different fidelity and cross-origin-isolation tradeoffs. Choose based on the parameter set in `CRUST_DESCRIPTOR` (true-peak, lookahead, oversampling 1–32×, multi-band — (c) is insufficient; (a) or (b) are the real options).
  2. Until (1) lands, surface the silence as a first-class user signal rather than a buried warn. Options (any is better than the current state):
     - Register a "not-implemented" strategy for `'crust'` that throws a typed `PluginNotImplementedError`, and teach `buildDeviceChain`'s catch block to emit a toast (same shape as `PluginRequiresIsolationError`). Mirrors the §8.19 SAB fallback pattern.
     - Tag `CRUST_DESCRIPTOR` with a new `unavailableReason: 'not-implemented'` field and have `EffectsTab` disable the entry with an explanatory tooltip.
     - Move `CRUST_DESCRIPTOR` out of `BUILTIN_PLUGINS` into a `PENDING_PLUGINS` list so it never reaches the picker. Least-friction, but loses the front-end work visually.
  3. Audit all other descriptors in `BUILTIN_PLUGINS` against both dispatch tables. Any descriptor whose `id` matches neither `DEVICE_FACTORIES` + `wasmDeviceRegistry` (live path) nor `DeviceFactoryRegistry` (render path) is a silent-add plugin. `Crumbs` (`CRUMBS_DESCRIPTOR`, `id: 'builtin-crumbs'`) is the next likely candidate: its `builtin-` prefix wins the `DeviceFactoryRegistry` matcher, but `DEVICE_FACTORIES['builtin-crumbs']` is undefined and its runtime state is driven entirely by `tauriInvoke('create_crumbs', …)` (`src/modules/Crumbs/repositories/crumbsBridge.ts`). On web, `createCrumbsInstance` short-circuits to a no-op and the UI is wired to a non-existent engine — same end state as Crust. This should be confirmed and either tagged `platform: 'native'` in the descriptor, or given a web-side fallback.
- **Generalised `createPluginNodeSafely` (§10.2 item 6)** — the current catch/notify block in `buildDeviceChain` is small enough to stay inline; the generalised wrapper is a refinement, not a blocker. Keep as structural-fix queue item — it becomes more attractive once a second error family (e.g. `PluginNotImplementedError`) joins `PluginRequiresIsolationError`.

### 8.20 — Proof (parametric EQ) non-functional (§3.20) — **UI PATH CLEANED UP; ENGINE PATH STILL GATED BY §8.19**

- **UI path cleaned up.** `src/modules/Proof/presentations/components/ProofEqSection.tsx` previously double-dispatched every numeric knob change (`updateBand` internally called `onSendParam`, and each knob's `onChange` also called `onSendParam` with the same `(name, value)` pair). The `enabled` toggle was worse: `updateBand` sent `onSendParam('eq_band{i}_enabled', value as number)` where `value` is a boolean, so the param value reaching the worklet was `NaN`/`true`/`false` depending on runtime coercion, and then the outer handler sent a proper 0/1 immediately after. Split the two concerns into `updatePatch` (state only) and `updateBandAndSend` (state + one numeric write-through); the `enabled` toggle now calls `updatePatch(i, 'enabled', next)` plus an explicit `onSendParam(..., next ? 1 : 0)`. Net effect: one param send per user action, correct 0/1 encoding for booleans. This is not the cause of "no audio" (the worklet is idempotent under duplicate sets), but it removes a real source of wasted MessagePort traffic and ambiguous wire values.
- **Q-knob wiring confirmed.** The Q knob in `ProofEqSection.tsx:117-130` calls `updateBandAndSend(i, 'q', v)` → `onSendParam('eq_band{i}_q', v)`. The dispatch path from UI is correct end-to-end through `ProofPanel` / `usePluginConnection`.
- **Engine path (not yet verified):** the `onSendParam` → `ProofNode.postMessage` → AudioWorklet parameter setter chain has not been audited at the worklet side yet. If `ProofNode` instantiation fails (most commonly the SAB-missing case handled by §8.19) the UI still sends events to a dead MessagePort. Now that the SAB-missing path fails with a typed `PluginRequiresIsolationError` and the banner surfaces it, the next concrete step is to confirm, under cross-origin-isolated conditions, that a param change in the UI produces the matching DSP change. That is the remaining §8.20 work.
- **Known UI quirk (not a bug):** `ProofEqCurve` only drags `freq` (X) and `gain` (Y); Q is only mutated via the per-band knob strip. The draggable dot on the curve does not move when Q changes — only the peaking-magnitude curve does. Document this in the UX copy if users get confused.

---

## 9. New Issues Surfaced During Investigation (Not in §2)

These are regressions / anti-patterns the walk-through found that the original issue list did not list explicitly.

| # | Symptom | Subsystem | Root Cause | Severity |
| --- | --- | --- | --- | --- |
| N1 | Duplicate `shortcutStore` modules with incompatible schemas (`Command/stores/shortcutStore.ts` vs `Workspace/models/Shortcuts.ts`) | Keyboard, State | Parallel implementations of the same domain concept in two modules; listeners mounted from both fire on the same key | **RESOLVED** — `Workspace/models/Shortcuts.ts` deleted; `Command/stores/shortcutStore.ts` is now the single source of truth with every binding (transport / editing / project / workspace / view / arrangement) defined in one place |
| N2 | Three keydown listeners mounted at `AppShell` (`useGlobalKeyboardShortcuts`, `useAppKeyboardShortcuts`, `startShortcutEngine`) | Keyboard | No single chokepoint; each hook attaches `window.addEventListener('keydown', …)` independently | **RESOLVED** — `useAppKeyboardShortcuts` and `startShortcutEngine` deleted; `AppShell.tsx` now mounts a single keydown listener via `useGlobalKeyboardShortcuts` |
| N4 | Single `recordingSession` prevents true multi-track audio recording | Audio recording | `AudioEngine/repositories/audioRecorder/recording.ts` models one session per app | **High** — breaks core DAW feature under "arm multiple tracks" |
| N7 | `trackStore.set(...)` write-path fans out to every subscriber per pointer-move for continuous controls | State / rendering | No selector / shallow-equal gating on the central store | **Medium** — perf root cause of §8.14; pattern also affects pan knobs, sends, device params |
| N9 | Visibility-filtered pitches (`getVisiblePitches`) gate rendering, hit-testing, lasso and rectangle selection uniformly; off-scale notes under fold disappear from every interaction path | MIDI editor | Same filter reused for every coordinate transform from pitch → row in the piano roll | **Medium** — after the §8.12 lasso overlap fix, this is the last remaining barrier to selecting chord-helper 3rd/5th notes under scale-lock. Fix requires a fold-contract UX decision (see §8.11 options), not a narrow filter tweak |
| N13 | Track selection model is scalar (`selectedTrackId: string \| null`) | State | Single-ID shape hard-coded throughout | **Medium** — blocks §8.18 and multi-select editing in general |
| N14 | `executeAppAction` merges handlers but `handlers/` + `useCases/*Handlers.ts` both build maps | Command architecture | Mixed layering from an in-progress migration per `AGENTS.md` | **Low** — architectural; makes handler ownership unclear and is a recurring footgun (see §8.1) |
| N18 | AudioWorklet plugin failures propagate as unhandled promise rejections | Audio engine | Each `create*Node` threw directly; only Grand Boule originally used the `PluginRequiresIsolationError` contract | **Closed for the SAB-missing class of failure** — every SAB-backed node (`Grand Boule`, `Gluten`, `Proof`, `Grinder`, `Bacteria`, `Scoring`) now calls `requireSharedArrayBuffer(pluginName)` at entry, `buildDeviceChain` catches and routes around, and `CapabilityBanner` + toast handle user feedback. Other failure families (WASM fetch, AudioWorklet registration, handshake timeout) still throw bare `Error` — a generalised `createPluginNodeSafely` is tracked under §10.2 item 6 |

---

## 10. Updated Remediation Plan (Supersedes §5)

### 10.1 — Landmine fixes (ship immediately, very small diffs)

1. ~~§8.8 / N2 — short-circuit duplicate spacebar handling~~ **RESOLVED** — superseded by the full unification in §10.2 item 1 below.

### 10.2 — Structural fixes (require spec + migration)

1. ~~**Unify the keyboard-shortcut architecture.**~~ **RESOLVED.** The parallel `Workspace/models/Shortcuts.ts` store, `shortcutEngine.ts`, `useAppKeyboardShortcuts.ts`, and `lintShortcutCollisions.ts` have all been deleted. Every shortcut is now defined in `Command/stores/shortcutStore.ts` and dispatched through the single `useGlobalKeyboardShortcuts` listener; `ShortcutsSection.tsx` edits the unified store directly. Tied §8.8 / N1 / N2 — all closed.
2. **Fix the recording lifecycle contract.** Single source of truth for "which clips are actively recording" (`activeRecordingRef`) and a single finalisation path reachable from every stop trigger (stop button, record toggle, spacebar-pause, escape). Ties to §8.7 / N5.
3. **Multi-recording-session support.** Refactor `AudioEngine/repositories/audioRecorder/recording.ts` to a `Map<trackId, RecordingSession>`. Ties to §8.18 / N4.
4. **Multi-track selection model.** Move `selectedTrackId` → `selectedTrackIds[]` with `primarySelectedTrackId` derived. Ties to §8.18 / N13.
5. **Continuous-control write path.** Replace per-pointer-move `trackStore.set(...)` with a split fast/commit path (ephemeral ref during drag, commit on release) and selector-based subscriptions. Ties to §8.14 / N7.
6. **Plugin node instantiation hardening.** The SAB-missing class is handled: `PluginRequiresIsolationError` + `requireSharedArrayBuffer(pluginName)` (`src/modules/AudioEngine/engine/pluginHostingErrors.ts`) are called by every SAB-backed node; `buildDeviceChain` catches the type and routes audio around the missing node. **Remaining structural work:** generalise to a `createPluginNodeSafely` wrapper that also catches WASM fetch failures, AudioWorklet registration errors, and handshake timeouts — publishing each as a structured, typed error with its own toast mapping. Not blocking; reach for this when the second error family appears. Ties to §8.4 / §8.19 / N18.
7. **Surface capability status in-app.** Landed. `src/utils/capabilities.ts` is the single source of truth; `CapabilityBanner` consumes it at `AppShell` mount and `buildDeviceChain` consults `hasSharedArrayBuffer()` to deduplicate signal. **Remaining:** migrate any remaining inline `typeof SharedArrayBuffer` / `window.crossOriginIsolated` probes (a grep sweep the next agent can do opportunistically) and add the Tauri-side header-parity check under §8.4.

### 10.3 — Feature-gap items (product decisions needed)

- §3.6 "Improve the templates" — product definition blocked.
- §3.10 Delay tempo sync — DSP + UI scope.
- §3.15 Device section IA — UX scope; not a regression.

---

## 11. Recommended New Instrumentation

Beyond §6:

- **Runtime-capability banner at boot:** landed as `CapabilityBanner` (`src/modules/Workspace/presentations/components/CapabilityBanner.tsx`). Dismissible per session via `sessionStorage`.
- **Action-dispatch trace ring buffer:** landed as `src/modules/Command/useCases/traceAppAction.ts`. Every `executeAppAction` call pushes `{ type, source, timestamp }` into a 128-entry ring on `window.__sourdaw_trace__` under Vite dev. Read with `__sourdaw_trace__.entries()` / `__sourdaw_trace__.clear()` from devtools. Zero production-path cost.
- ~~**Shortcut collision linter:**~~ **RETIRED** — no longer needed. With the unification in §10.2 item 1, there is exactly one shortcut store and one listener, so cross-store collisions are structurally impossible. The linter file was deleted with the rest of the parallel Workspace shortcut stack.
- **Recording-lifecycle inspector:** a dev-only overlay showing `activeRecordingRef.current`, `transport.isRecording`, and the recorded clips' `endBeat` values in real time. Makes §8.7 self-diagnosing. **Not yet landed.**
- **Write-path profiler:** in dev, wrap `trackStore.set` to track time-to-next-frame and number of downstream re-renders. Emit a warning when a single `set` triggers >N renders in <M ms. Will expose the §8.14 problem and similar ones automatically. **Not yet landed.**

---

## 12. Reproduction Quick-Reference

| Issue | Minimal steps | Expected vs Actual |
| --- | --- | --- |
| §8.7 Recording mirror drift | Start a recording via `transport.toggleRecording`, then trigger any path that calls Arrangement's `stopRecording` without going through Transport (or vice-versa) — or arm no tracks and try to record | `activeRecordingRef` and Transport's `activeRecordingClipIds` should agree. Actually: they can drift, and `buildTimelineRenderModel`'s recording overlay re-appears after stop |
| §8.8 Spacebar | Focus anywhere outside a text input → press Space | Playback should start. Actually: flickers on/off |
| §8.14 Faders | Drag a track gain fader slowly | Value tracks pointer. Actually: stair-steps; catches up on release |
| §8.18 Multi-track rec | Arm 2 audio tracks → record | Both buffers captured. Actually: only last-armed track gets audio |

---

## 13. Status Summary

| Status | Issues |
| --- | --- |
| CONFIRMED (root cause found) | §8.4, §8.14, §8.18 |
| RESOLVED | §8.7 recording-lifecycle mirror drift (single `activeRecordingRef`, parameterless `stopRecording()`, drift invariant in `buildTimelineRenderModel`); §8.8 spacebar / full keyboard-shortcut unification (`Command/stores/shortcutStore.ts` single source of truth, `useGlobalKeyboardShortcuts` single listener, Workspace shortcut stack deleted); §8.9 panel scoping invariant (`useActiveDevicePanel` captures `trackId` and subscribes to `trackStore`); §8.12 lasso center-point bug; §8.16 timeline zoom key path; §8.19 SAB-missing contract across every SAB-backed node; §8.20 UI-side double-dispatch in `ProofEqSection`; §11 capability banner + action-dispatch trace ring buffer; N1 / N2 duplicate-shortcut-store and multi-listener (closed by §8.8 unification); N18 for the SAB-missing family; §10.2 item 1 |
| OPEN — surveillance only | §8.2 (instrumented — close once logs confirm no `tools` in payload keys) |
| SCOPE CLARIFIED — parked for spec | §8.11 (off-scale notes hidden under fold; needs fold-contract UX decision), §8.12 off-scale lasso miss (same decision), §8.16 minimap resize (feature gap, not a regression) |
| PARTIALLY CONFIRMED | §8.20 engine-side worklet param wiring (verifiable once under cross-origin-isolated conditions) |
| MISSING IMPLEMENTATION — needs spec | §8.19 Crust (front-end ships, engine-side DSP does not exist anywhere in the repo; `CRUST_DESCRIPTOR` has no matching device-strategy, so adds are silently skipped by `buildDeviceChain`) |
| UX SCOPE (not a regression) | §8.15 |
| FEATURE GAP (no regression) | §8.6, §8.10, §8.16 minimap resize affordance |
| NEW ISSUES SURFACED | §9 (N4, N7, N9 elevated-to-medium, N13, N14) — N1 and N2 closed by the §8.8 unification |
| NEW ISSUES SURFACED (Generate panel) | §14 (G1, G2) |
| DEFERRED — needs spec | §14.1–14.2 / G1+G2 — `MidiNote.startBeat` absolute-vs-relative coordinate unification; §8.11 fold-contract linked decision |

**`MidiNote.startBeat` deferred reason:** standardising on clip-relative requires changes to `clipDrawing.ts`, `createWebGpuRenderer.ts`, `renderOffline.ts`, `duplicateClipCore.ts`, and both AI apply functions, plus a data migration for existing projects and updates across hundreds of tests. It is not a quick win — it needs its own spec and a planned migration.

---

## 14. Generate Panel — Algorithmic Progression & Melody Generators

User report: "When I add an algorithmic progression or melody generator to a track, the clips often appear empty, or sometimes they don't appear at all."

Two separate entry points produce clips from the same `addClip` / `addMidiNote` plumbing:

- **Patterns tab → Template card "Insert" button.** `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx` `handleInsertTemplate` → `addClip(...)` then a loop of `addMidiNote(clip.id, pitch, note.startBeat, ...)`.
- **AI sub-tab / AI actions + timeline empty-area context menu (`generateMelody`, `generateChordProgression`, `generateDrumPattern`).** `src/modules/AiGeneration/handlers/generation/createGenerationHandler.ts` dispatches `applyMelodyToTrack` / `applyChordProgressionToTrack` / `applyDrumPatternToTrack`. Both live in `src/modules/AiGeneration/useCases/generate{Melody,ChordProgression,DrumPattern}/applyToTrack.ts` and call `addMidiNote(clip.id, pitch, startBeat + note.startBeat, ...)`.

The two paths use **incompatible conventions** for the `MidiNote.startBeat` coordinate. The rest of the codebase is also split, which is the real root cause.

### 14.1 Root cause — `MidiNote.startBeat` has two incompatible meanings across the codebase

- **Timeline clip preview** (`src/modules/Arrangement/presentations/renderers/clipDrawing.ts:352`):
  `const relStart = note.startBeat - clip.startBeat + loopOffset;`
  Notes are drawn only if `relStart + note.duration > 0` and `relStart < clipDuration`. This is an **absolute-beat** contract: for a note to be visible inside a clip whose `startBeat = 8`, `note.startBeat` must be in `[8, endBeat)`.
- **Offline renderer** (`src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:43`): same absolute contract.
- **Duplicate clip** (`src/modules/Arrangement/useCases/clip/duplicateClipCore.ts:42`): `startBeat: note.startBeat + beatDelta` — also absolute.
- **Piano Roll renderer** (`src/modules/Workspace/presentations/hooks/usePianoRollRenderer.ts:467`):
  `const x = note.startBeat * beatWidth;` — no subtraction of `clip.startBeat`. This is a **clip-relative** contract: a note at the left edge of the roll is `startBeat = 0`.
- **Piano Roll interactions** (`src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts:318, 340, 545, 693, 782`): user-created notes are inserted with `beat = (e.clientX - rect.left) / beatWidth`, i.e. clip-relative.
- **`importMidiFile`** (`src/modules/Arrangement/useCases/importMidiFile.ts:42`): forces `clip.startBeat = 0`, which masks the inconsistency entirely because `absolute == clip-relative` when `clip.startBeat === 0`.

The only reason this hasn't exploded before is that most internally created clips land at `startBeat = 0` (playhead at 0, import MIDI forces 0). Once a clip is placed at `startBeat > 0`, **every downstream view that uses the opposite convention treats the clip as empty.**

### 14.2 Symptoms, tied to root cause

- **Patterns tab inserts an "empty" clip on the timeline when playhead > 0.**
  `PatternBrowser.tsx:275 addMidiNote(clip.id, note.pitch, note.startBeat, ...)` passes the template-local beat (0..`lengthBeats`) unchanged. `addMidiNote` (`src/modules/MIDI/useCases/midiNoteCrud/addMidiNote.ts:19`) clamps `safeStart = Math.max(0, startBeat)` and stores as absolute. With playhead at beat 8, `clip.startBeat = 8`, notes stored at absolute beats 0..16, renderer computes `relStart = 0 - 8 = -8`, fails the `relStart + duration > 0` guard for most notes → timeline clip preview is blank. Double-clicking the clip opens Piano Roll, which uses clip-relative math, so notes *are visible there*, producing a confusing "timeline empty, editor full" state.
- **AI chord/melody action produces a clip that looks empty when opened in Piano Roll.**
  `applyMelodyToTrack` / `applyChordProgressionToTrack` pass `startBeat + note.startBeat`, which is the absolute beat. Timeline preview computes `relStart = note.startBeat` correctly. But Piano Roll renderer draws at `x = (startBeat + note.startBeat) * beatWidth`, so when playhead = 8 beats, every note is offset 8 beats to the right of the roll's left edge; in a typical view that scrolls the notes completely off screen → user sees a clip with "no notes" in the piano roll while the timeline preview is fine.
- **Depending on which view the user is focused on at insert time, the same bug presents either as "empty clip on timeline" or "empty piano roll".** Matches both halves of the report.

### 14.3 Secondary issues

- `generateChordProgression` respects `rhythm = 'whole'` as the default, yielding one downbeat note per bar (`algorithm.ts:158-160`). Combined with the absolute-vs-relative rendering bug above, the total count of visible notes in a 4-bar pop progression can be as low as 4 × 3 = 12 and all of them can be hidden. The "one note per bar" default is worth revisiting as a UX choice once G1 lands.

### 14.5 Evidence — exact file:line references

| Path | Line(s) | What it shows |
| --- | --- | --- |
| `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx` | 249–280 | Insert handler; raw `note.startBeat` passed to `addMidiNote` (G2) |
| `src/modules/MIDI/useCases/midiNoteCrud/addMidiNote.ts` | 17–22 | Clamping rules; ambiguity over whether `startBeat` is absolute or relative |
| `src/modules/Arrangement/useCases/clip/addClip.ts` | 26–46 | No overlap check, no side-effect on selection |
| `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` | 340–369 | Timeline preview uses **absolute** convention (G1) |
| `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts` | 43 | Offline renderer uses **absolute** convention (G1) |
| `src/modules/Arrangement/useCases/clip/duplicateClipCore.ts` | 42 | Duplicate uses **absolute** convention (G1) |
| `src/modules/Workspace/presentations/hooks/usePianoRollRenderer.ts` | 467 | Piano Roll uses **clip-relative** convention (G1) |
| `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts` | 318, 340, 545, 693 | User-created notes are inserted with clip-relative beats (G1) |
| `src/modules/AiGeneration/useCases/generateMelody/applyToTrack.ts` | 14–31 | Adds `startBeat` to `note.startBeat` — will double-offset once G1 lands |
| `src/modules/AiGeneration/useCases/generateChordProgression/applyToTrack.ts` | 18–36 | Same pattern |

### 14.6 New issues surfaced (append to §9 mental model)

| ID | Issue | Area | Severity |
| --- | --- | --- | --- |
| G1 | `MidiNote.startBeat` coordinate is inconsistent — absolute in the timeline/renderOffline/duplicate paths, clip-relative in the Piano Roll and user-creation paths; neither contract is documented or tested | MIDI model | **High** — root cause of generator-clip invisibility and a latent foot-gun for any feature that creates clips at `startBeat > 0` |
| G2 | `PatternBrowser.handleInsertTemplate` writes template-local beats as if they were absolute (resolves when G1 lands) | Pattern browser | **High** — direct cause of "empty timeline clip" when playhead > 0 |

### 14.7 Remediation direction (not a spec; inputs for one)

1. **Fix the coordinate contract first.** Pick one convention for `MidiNote.startBeat`. The codebase is doing the clip-relative thing in every user-facing MIDI editing path already (click-to-create, drag, step input, chord stamp all use clip-relative beats) — standardise on clip-relative and update the two absolute-convention consumers (`clipDrawing.ts`, `renderOffline.ts`) to **not** subtract `clip.startBeat`. Audit all `note.startBeat + …` arithmetic after the decision. Add a unit test that creates a clip at `startBeat = 8` with a single note at `startBeat = 0`, asserts it renders in both the timeline preview and the piano roll.
   **Scope caveat:** touches `clipDrawing.ts`, `createWebGpuRenderer.ts`, `renderOffline.ts`, `duplicateClipCore.ts`, both AI apply functions, and requires a data migration for existing projects plus hundreds of test fixture updates. Not a quick win — this is the spec item.
2. **Fix the two apply paths to the new convention.**
   - `PatternBrowser.handleInsertTemplate` already writes clip-relative — once step 1 is done, this path is correct.
   - `applyMelodyToTrack` / `applyChordProgressionToTrack` must stop adding `startBeat` to `note.startBeat` and instead let the clip's `startBeat` carry the offset.

   Waits on step 1.
