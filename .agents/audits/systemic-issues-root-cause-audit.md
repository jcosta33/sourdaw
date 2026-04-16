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
| 19. Curst/Gluten/Proof no audio | No noticeable difference in sound, SharedArrayBuffer errors | Audio engine, Plugin lifecycle | Incomplete plugin fallback / SAB error cascade |
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

### 19) Curst, Gluten, and Proof produce no audible effect
- **Symptom:** No noticeable difference in sound. Associated with SharedArrayBuffer errors for Gluten/Proof.
- **Subsystem:** WebAssembly / worker / SharedArrayBuffer-related, audio engine / DSP-related, plugin lifecycle-related
- **Regression Surface:** Plugin DSP initialization, Audio graph routing.
- **Hypotheses:** The DSP nodes fail to initialize (due to SAB missing, see #4) and silently bypass the audio graph to prevent crashes, but UI indicates they are active. Alternatively, wet/dry mix defaults to 0%.
- **Code to Inspect:** Audio engine node connections, `Gluten`/`Proof`/`Curst` WASM wrappers, Error boundaries for AudioWorklets.
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

### 8.1 — Duplicate handler warnings (§3.1) — **STALE**

- **Claim in §3.1:** Four `executeAppAction` duplicates at boot (`audioToMidi`, `stripSilence`, `detectKey`, `detectTempo`).
- **Evidence:** The duplicate-warn path is `mergeHandlers()` in `src/modules/Command/useCases/executeAppAction.ts:46-50`. The historical duplicate source was `src/modules/AiGeneration/useCases/getAiMidiHandlers.ts` — its current header comment (L9-14) explicitly states these four entries were removed and re-homed. Confirmed by `grep`: the four keys now exist exclusively in `src/modules/Arrangement/handlers/clip/clipHandlers.ts:63, 67-69`.
- **Root cause (historical):** Two modules built handler maps for the same `AppAction.type` because the "clip analysis" actions straddled the `Arrangement` / `AiGeneration` boundary (violation of *one-owner-per-action*).
- **Recommendation:** No code change required for the original symptom. However, `mergeHandlers` only *warns* and silently overwrites — it should `throw` in dev so this class of drift fails loudly next time. File-line: `executeAppAction.ts:46-50`.
- **Instrumentation upgrade:** Replace `logger.warn(...)` with `throw new Error(...)` guarded by `import.meta.env.DEV`.

### 8.2 — WebLLM `UnsupportedModelIdError` on Qwen3 (§3.2) — **PARTIALLY CONFIRMED**

- **Evidence:**
  - `src/modules/AiRuntime/repositories/webLlm/toolCalling.ts:10-12` explicitly documents that Qwen3-4B does **not** implement `ChatCompletionRequest.tools`, and the intended path is a plaintext system-prompt tool schema + `parseToolCallXml`.
  - The orchestrator `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts:86-94` selects a tool subset via `selectToolsForPrompt` and calls `generateWebLlmToolCalls(...)`. That function lives in `toolCalling.ts` and uses the plaintext workaround — *not* the unsupported `tools` array. So the nominal path is correct.
- **Why the warning still appears:** The warning message `[WebLLM] Tool call API failed: UnsupportedModelIdError...` is not produced by `toolCalling.ts` (which never calls `engine.chat.completions.create({ tools })`). It is produced elsewhere — most likely a stale call site that still threads `tools: DAW_TOOL_SCHEMAS` into the MLC completion. Search for any site that spreads `tools` into a `ChatCompletionRequest` and remove it. This is the remaining gap to close.
- **Fix direction:**
  1. Grep the codebase for `ChatCompletionRequest` and any object literal containing `tools:` passed to an MLC-compatible engine.
  2. Gate the tool-array path behind a `capabilities.supportsToolsApi` flag keyed on model ID.
  3. Log the **model ID and payload keys** (not the payload itself — token cost) on every completion invocation so future regressions surface immediately.

### 8.3 — Sampler (Crumbs) position poll failure (§3.3) — **PARTIALLY ADDRESSED — poll still runs on web**

- **Evidence:** `src/modules/Crumbs/repositories/crumbsBridge.ts` exposes `getCrumbsPosition`, `loadSample`, `getWaveformPeaks`, `detectOnsets`, `detectSamplePitch` over `tauriInvoke`. The data-returning calls now throw a typed "only available in the Sourdaw desktop app" error when invoked outside Tauri, but **the polling loop itself still starts**: `src/modules/Crumbs/useCases/positionTracking.ts:57` catches the error and logs a warn every poll tick (~30 Hz, the interpolation loop rate).
- **Root cause:** The bridge has a guard; the consumer does not. `startPositionTracking` / `loadSample` / etc. never check `isTauri()` before beginning the loop.
- **Fix direction:**
  1. `startPositionTracking` must short-circuit when `!isTauri()` instead of entering the poll loop and relying on per-tick errors.
  2. Same shape for any other Crumbs caller that mounts on web (sample load, waveform-peaks hydration).
  3. Strategic follow-up (§8.21 / N15 / capabilities module): move the guard into `tauriInvoke` itself and have it return `undefined` in web builds, so the typed error strategy is consistent app-wide.

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

### 8.5 — KneadEditor pitch analysis stub (§3.5) — **REFUTED (message stale)**

- **Evidence:**
  - The specific warning string `Real DSP pitch analysis is not wired up yet for track` does **not** appear anywhere in the current codebase (checked via `rg -F`). It is from an older build.
  - `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx:42-47` imperatively calls `analyzePitchForClip` on mount for tracks with Knead enabled when pitch data is missing.
  - `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts` (currently modified in `git status`) initializes `daw_dsp` WASM via `init()` and runs a `KneadInstance` offline pipeline. The WASM binding is real.
- **What can still fail silently:** `getBufferForClip` (`src/modules/Arrangement/useCases/audioAnalysis/helpers.ts:4-17`) returns `null` when the clip is not an audio clip, when the track is absent, or when `audioBufferId` is unresolved. `analyzePitchForClip` silently exits in that case with no user feedback — which feels like "not wired up" even though the pipeline exists.
- **Fix direction:** Add a `logger.info` at `analyzePitchForClip` when the buffer resolution fails (trace-level, not warn), and surface a UI toast when the editor opens on a clip whose buffer is missing. Otherwise no code change required — treat the original audit claim as a stale regression report.

### 8.6 — "Improve the templates" (§3.6) — **UNCHANGED**

- Pure product note. No code evidence to gather. Requires a product decision: project-level vs. track-preset vs. plugin-patch templates. Surface at next triage; do not block engineering on it.

### 8.7 — MIDI clip cut by playhead after recording (§3.7) — **RECORDING-LIFECYCLE MIRROR DRIFT STILL OPEN**

- **Context:** The render model consults `activeRecordingRef` every frame (`src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:224-227` → `applyRecordingOverlay` → `buildTimelineRenderModel.ts:83-84`) and overwrites each active-recording clip's `endBeat` with `playheadPositionRef.current`. Anything that leaves `activeRecordingRef.current` non-empty after the transport has stopped recording will re-appear as "clip cut by playhead".
- **Open issue — two mirrored sources of truth:** `src/modules/Transport/useCases/transportControls/toggleRecording.ts:16` keeps a module-level `activeRecordingClipIds` array, while Arrangement keeps `activeRecordingRef.current`. The two can drift: e.g. `startRecording` returning zero clips (no armed tracks) while Transport still sets `isRecording = true`; or any future path that calls Arrangement's `stopRecording` without going through Transport (or vice-versa).
- **Fix direction:**
  1. Delete `activeRecordingClipIds` from Transport. Derive it from `activeRecordingRef` on the Arrangement side whenever Transport needs to know which clips are being recorded.
  2. Unify finalisation in a single Arrangement use case (e.g. `finalizeRecording`) that *every* stop path — record button, transport stop, spacebar, escape, shortcut, app blur — must call. Transport should not unilaterally flip `isRecording`.
  3. Add a dev-only invariant check: if `transport.isRecording === false` and `activeRecordingRef.current.length > 0`, throw in dev / emit a warn in prod.

### 8.8 — Spacebar does not play (§3.8) — **CONFIRMED — two-listener race**

- **Evidence:**
  - Three keydown listeners are mounted at `AppShell` simultaneously:
    1. `useGlobalKeyboardShortcuts` (`src/modules/Workspace/presentations/hooks/useGlobalKeyboardShortcuts.ts:29`) — delegates to `Command/handleKeydown` which looks up `Command/stores/shortcutStore.ts` (definitions + customMappings model) and for `Space` dispatches `transport.togglePlayback` via `executeAppAction`.
    2. `useAppKeyboardShortcuts` (`src/modules/Workspace/presentations/hooks/useAppKeyboardShortcuts.ts:144`) — panel toggles and save/export; doesn't bind Space directly.
    3. `startShortcutEngine` (`src/modules/Workspace/useCases/shortcutEngine.ts:148`) — iterates `Workspace/models/Shortcuts.ts` bindings (separate store, `ShortcutState { bindings }` model) where `PLAY_PAUSE: { key: ' ' }` calls `togglePlayback()` directly.
  - Both #1 and #3 match on spacebar at `window`-level keydown. Neither uses `stopImmediatePropagation`. `togglePlayback()` is invoked twice per press.
- **Net behaviour:** first call sets `isPlaying = true` and starts transport; second call sees `isPlaying = true` and immediately pauses. Net: nothing appears to play.
- **Secondary finding (MAJOR — not in original audit):** **Two different `shortcutStore` modules exist with identical export names but incompatible schemas.**
  - `src/modules/Command/stores/shortcutStore.ts` — `{ definitions: ShortcutDefinition[], customMappings }` and string-key bindings like `"Space"`.
  - `src/modules/Workspace/models/Shortcuts.ts:64` — `{ bindings: ShortcutMap }` and literal-char bindings like `{ key: ' ' }`.
  
  Each listener reads its own store. This is an architectural violation: shortcut definitions are not a shared contract. Under the domain-driven rules in `AGENTS.md`, shortcut bindings are Command-module concerns; Workspace should only toggle panels.
- **Fix direction:**
  1. Delete `Workspace/useCases/shortcutEngine.ts` and `Workspace/models/Shortcuts.ts`. Migrate `PLAY_PAUSE`/`STOP_RETURN`/`TOGGLE_*` into `Command/stores/shortcutStore.ts` as `ShortcutDefinition` rows.
  2. Keep only `useGlobalKeyboardShortcuts` as the single handler mount; remove duplicate listeners in `AppShell` (`AppShell.tsx:152, 158, 162`).
  3. Until #1 is shipped, have `shortcutEngine` short-circuit if `e.defaultPrevented` is already true, and call `e.preventDefault()` / `e.stopImmediatePropagation()` at the *first* handler to deduplicate.

### 8.9 — Plugin panels persist on track switch (§3.9) — **CONFIRMED**

- **Evidence:**
  - Panel state is opened via an event bus contract: `src/modules/Workspace/useCases/panels/devicePanels/showDevicePanel.ts:11` emits `'panel.showDevice'` with `{ deviceType, deviceId }`. Subscribers: `src/modules/Workspace/useCases/panels/devicePanels/onShowDevicePanel.ts:14`.
  - `src/modules/Arrangement/useCases/toggleTrackState/selectTrack.ts:6-14` only updates `selectedTrackId` and wires MIDI input. **No panel dismissal is emitted.**
  - No `'panel.hideDevice'` / `'panel.hideAll'` event is ever emitted on track selection change anywhere in `src/modules/**`.
- **Fix direction:**
  1. Add a `panel.hideAllDevices` event and subscribe in every device panel view (or at the `BottomPanelHost` level).
  2. `selectTrack` should emit that event whenever `selectedTrackId` actually changes (not when it's re-selected).
  3. Consider a stronger invariant: device panels are *scoped to* `{ trackId, deviceId }` — if the current `selectedTrackId` no longer matches the panel's owning track, the panel should render nothing. This removes the need for imperative cleanup entirely.

### 8.10 — Delay tempo-sync (§3.10) — **UNCHANGED (feature gap)**

- Confirmed as a genuine feature gap — no code exists for note-division sync in `src/modules/AudioEngine/repositories/devices/reverbDelay/`. Requires product scope + DSP parameter design. Not a regression; no root-cause remediation applies.

### 8.11 — Chord helper notes cannot be expanded (§3.11) — **PARTIALLY REFUTED**

- **Evidence against the "missing IDs" hypothesis:**
  - `src/modules/MIDI/useCases/chordStamps/stampChord.ts:22-42` builds notes via `createMidiNote` (`src/modules/MIDI/models/MidiNote.ts:28-41`). Each note has a unique `id`, proper `startBeat`, `duration`, `velocity`. They are normal MidiNotes, not transient entities.
  - `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts` uses those IDs through the same hit-test path as any other note.
- **Probable real cause:** hit-testing filters by `getVisiblePitches(scaleType, scaleRoot, isFolded)`. Chord intervals (e.g. `+3` minor third, `+7` fifth) may land on pitches that are **not in the current scale filter** when fold/scale-lock is active. Those notes are drawn faded, but `indexOf(note.pitch) === -1` excludes them from hit tests and rectangle selection (see `usePianoRollInteractions.ts:522-531`). So the user cannot click-select the 3rd or 5th if their roots are scale-locked to the root.
- **Secondary real cause:** in chord mode the click-handler branch returns after `stampChord` without setting `dragRef.current.mode`, so subsequent `mouseMove`/`mouseUp` read a stale `'none'` state — but more importantly, the *next* click in chord mode creates another chord on top of the existing notes instead of selecting them. Toggle chord mode off to select.
- **Fix direction:**
  1. When chord mode is active and the click lands on an existing note, select/move it instead of stamping.
  2. In the hit-test path, consult `notes` directly instead of gating through `getVisiblePitches`. Faded notes should remain selectable; visibility-for-rendering and hit-testing should not share the same filter.
  3. Add a "stamp chord tool off → select last stamped" affordance.

### 8.12 — Lasso / rectangle selection (§3.12) — **CONFIRMED (two bugs)**

- **Bug A — rectangle selection hidden behind `Alt`:** `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts:278-292` gates rubber-band mode on `e.altKey`. Default-drag in empty space falls through to `draw` / `paint` / `chord`, never rectangle-select. Users expect the DAW convention "drag in empty area = rectangle select". Currently rectangle selection is **discoverable only via Alt-drag**, which no onboarding mentions.
- **Bug B — lasso uses center-point test:** `usePianoRollInteractions.ts:625-649` runs a point-in-polygon check on `(cx = note.center, cy = note.rowCenter)`. For long notes, the lasso can enclose a significant part of the note without enclosing its center. For notes outside the current scale filter, `row = visiblePitches.indexOf(note.pitch)` returns `-1` and they are skipped entirely (same visibility-vs-hit-test pitfall as §8.11).
- **Fix direction:**
  1. Make `!altKey && !lassoMode && !chordMode && !drawMode` trigger rectangle-select by default in empty area.
  2. Lasso polygon test must check note **overlap**, not center. Extrude each note to its bounding box `(nx, ny, nw, ROW_HEIGHT)` and use a rect-vs-polygon overlap test, with the same visibility-vs-hit-test decoupling as Bug §8.11.

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

### 8.15 — `TrackDevicesSection` menu huge (§3.15) — **CONFIRMED**

- **Evidence:** `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx:84-187` renders three `getPlatformPlugins().filter(...)` iterations inline, three times traversing the full plugin catalog, each producing a list of flat buttons. The scannedPlugins external list (L142-186) is an uncategorised flat scroll of every plugin found on the system. No search filter, no categorisation beyond the initial `effect`/`utility`/`analyzer`/`external` split.
- **Additional issue (not in original audit):** `getPlatformPlugins()` is called **three times per render**, each walking the full catalog. Move to a single `useMemo`-free `const all = getPlatformPlugins()` at the top of the component.
- **Fix direction:** Exactly as in §3.15 — decompose into accordions by category, add a search, and virtualise the external list if it gets long.

### 8.16 — Timeline zoom shortcut broken (§3.16) — **CONFIRMED — wrong key binding**

- **Evidence:**
  - Zoom bindings in `src/modules/Command/stores/shortcutStore.ts:60-71`: `['=', '+']` for `view.zoomIn` and `['-']` for `view.zoomOut`. **No `mod+=` entry.**
  - Matcher `src/modules/Command/useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown.ts:47-71` requires `hasMod === desc.mod`, i.e. it will only match `=`/`+`/`-` when **no modifier** is pressed. But on macOS `Cmd+=` sets `mod=true`, so the matcher rejects it and the browser's native zoom (`Cmd+=`) intercepts the key.
  - Handler branch `handleKeydown.ts:113-118` does receive `zoomIn`/`zoomOut` callbacks and forward to `zoomTimeline(±ZOOM_STEP)` — so the command wiring is fine; only the default keys are wrong.
- **Fix direction:**
  1. Update `defaultKeys` to `['mod+=', 'mod++']` and `['mod+-']`. Conventional DAWs usually use `Cmd/Ctrl + Plus` for app-zoom and do call `e.preventDefault()` to beat the browser.
  2. The matcher supports `mod+` prefix already (`handleKeydown.ts:55-57`). Nothing else needs to change.
  3. **Must add `e.preventDefault()` when matching — otherwise browser zoom wins even after the app executes the callback.** `executeShortcutAction` currently has no way to tell the DOM layer to prevent default. Plumb a return value (or pass the `KeyboardEvent` down into `executeShortcutAction`) so matched zoom shortcuts can preventDefault.
- **Minimap resizing:** separate item — not yet validated. Needs its own inspection pass.

### 8.17 — Levain (§3.17) — **TWO BUGS OPEN**

- **Bug C (unreported — memory pressure):** The transferable-buffer path sends each decoded sample to the worklet with `postMessage([transferable])`, and the browser transfers ownership, which is great. But the same buffer is first held in `fetchAndDecode` — if the worklet processor is slow to acknowledge (no ack flow exists), the main thread can queue dozens of MBs of MessagePort backpressure. Consider ack-based flow control for large banks. Not a correctness bug but a hidden cause of "ages to boot" on slow machines.
- **Bug D (wrong instrument):** `src/modules/Levain/useCases/autoLoadSamples.ts:13` defaults `instrumentId = 'violin-1'`. If the user wanted the piano (based on the audit's mention of "Levain piano"), the caller path is wrong — piano samples live under a different `instrumentId` and the hardcoded default loads violin first. Verify via `getLevainInstruments` that the default matches the UI-selected instrument.

### 8.18 — Multi-track selection missing (§3.18) — **CONFIRMED + recording bug**

- **Evidence (selection model):** `src/modules/Arrangement/stores/trackStore.ts:22-28` models selection as a singular `selectedTrackId: string | null`. No `selectedTrackIds: Set<string>`. Every consumer of track selection (Inspector, automation lanes, deletion commands) reads the single ID.
- **Secondary finding (MAJOR — multi-track *audio recording* is broken):** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:36-63` holds a single `recordingSession: RecordingSession` via `createHmrPersistentState`. There is exactly one `mediaStream`, one `sourceNode`, one `recordingNode`, and one `onRecordingComplete`. When `toggleRecording` loops over multiple armed audio tracks (`src/modules/Transport/useCases/transportControls/toggleRecording.ts:27-59`) and calls `startAudioRecording(trackId, ...)` once per track, **each successive call overwrites the previous session's state** — the previous track's `onRecordingComplete` is orphaned, its worker keeps filling a SAB that no one reads, and only the last-armed track actually produces a buffer on stop.
  - Note that §3.18 described this as "missing multi-track selection". The audio-recording failure is a separate, more severe consequence of the same single-selection assumption.
- **Fix direction:**
  1. Refactor track selection to `selectedTrackIds: string[]` (ordered) with `primarySelectedTrackId` derived (last click). Every consumer must migrate simultaneously — this is a bulk refactor best done under a proper spec.
  2. Refactor `recording.ts` to hold `recordingSessions: Map<trackId, RecordingSession>` so multiple tracks record into independent rings. Each `stopAudioRecording` stops its own session; a `stopAllAudioRecording` convenience exists for the common "stop everything" path.
  3. The §7 spec should treat these as two independently-landed milestones, with the recording fix gated on the new session map (not on the selection refactor).

### 8.19 — Gluten / Proof / Curst silent (§3.19) — **CONFIRMED (downstream of §8.4)**

- **Evidence:**
  - Gluten and Proof construction fails when `telemetryAllocator.ensureInit()` (`:112-119`) fails to allocate a SAB. Without COOP/COEP cross-origin isolation, this throws, and both nodes currently fail loudly at construction (`GlutenNode.ts:55-59`).
  - **However, there's an asymmetry:** Grand Boule throws hard (`GrandBouleNode.ts:84-90`), but the failure isn't caught anywhere obvious — it propagates as an unhandled rejection and the node silently fails to join the audio graph. The user sees the plugin chip in the Inspector but hears no effect.
  - Curst is not SAB-dependent. A separate code path is responsible for Curst's silence; likely a wet/dry default or routing bug. Not yet fully validated.
- **Fix direction:**
  1. Wrap node construction in a user-surfaced error boundary that maps `SharedArrayBuffer`-related errors to a typed `PluginRequiresIsolationError`, display a clear banner "this plugin requires cross-origin isolation", and route around the missing node (bypass instead of silent failure).
  2. Curst: verify the default patch has non-zero wet mix and that parameter updates reach the DSP node. Likely the same shape as §8.20 (knobs → engine disconnect).

### 8.20 — Proof (parametric EQ) non-functional (§3.20) — **PARTIALLY CONFIRMED**

- **Evidence (UI side works):** `src/modules/Proof/presentations/components/ProofEqCurve.tsx:244-260` handles pointer drag, computes freq/gain, calls `onPatchChange({ eqBands })` AND `onSendParam('eq_band0_freq', ...)` / `onSendParam('eq_band0_gain', ...)`. So the UI does emit parameter events — refutes the strict reading of the hypothesis.
- **Evidence (engine side likely broken):** The chain from `onSendParam` down to the Proof AudioWorklet parameter setter needs verification — it hinges on `ProofNode` subscribing to param events and forwarding them through its MessagePort. If `ProofNode` fails to instantiate (see §8.19, SAB) the `onSendParam` calls succeed in the React tree but dead-end before DSP.
  - This is the most plausible explanation: **Proof fails SAB init → the node is never attached → the UI draws fine and sends param events to nothing.**
- **Fix direction:** Must be paired with §8.19. First surface the init failure, then confirm param wiring when the node actually exists.
- **UI-side real issues:**
  - `Q` parameter has no drag affordance in `ProofEqCurve` — only `freq` (X) and `gain` (Y). The audit's "knobs do nothing" likely included the Q knob which lives elsewhere (in `ProofEqSection.tsx`). Verify that section's knobs dispatch `onSendParam` for `q` too.
  - The Q defaults to whatever is in `band.q` and only the peaking-magnitude curve responds to it; the draggable dot does not move when Q changes, which is fine but may be confusing.

---

## 9. New Issues Surfaced During Investigation (Not in §2)

These are regressions / anti-patterns the walk-through found that the original issue list did not list explicitly.

| # | Symptom | Subsystem | Root Cause | Severity |
| --- | --- | --- | --- | --- |
| N1 | Duplicate `shortcutStore` modules with incompatible schemas (`Command/stores/shortcutStore.ts` vs `Workspace/models/Shortcuts.ts`) | Keyboard, State | Parallel implementations of the same domain concept in two modules; listeners mounted from both fire on the same key | **High** — enables §8.8 double-toggle and creates permanent drift risk |
| N2 | Three keydown listeners mounted at `AppShell` (`useGlobalKeyboardShortcuts`, `useAppKeyboardShortcuts`, `startShortcutEngine`) | Keyboard | No single chokepoint; each hook attaches `window.addEventListener('keydown', …)` independently | **High** — root enabler of §8.8 and future shortcut collisions |
| N3 | `mergeHandlers` warns on duplicate action keys but silently overwrites | Command dispatch | `executeAppAction.ts:46-50` uses `logger.warn` + assignment instead of throwing in dev | **Medium** — allows silent contract drift |
| N4 | Single `recordingSession` prevents true multi-track audio recording | Audio recording | `AudioEngine/repositories/audioRecorder/recording.ts` models one session per app | **High** — breaks core DAW feature under "arm multiple tracks" |
| N7 | `trackStore.set(...)` write-path fans out to every subscriber per pointer-move for continuous controls | State / rendering | No selector / shallow-equal gating on the central store | **Medium** — perf root cause of §8.14; pattern also affects pan knobs, sends, device params |
| N9 | Visibility-filtered pitches (`getVisiblePitches`) gate hit-testing as well as rendering | MIDI editor | Same filter reused for two purposes | **Low** — root cause of §8.11 chord-fold issue and §8.12 Bug B lasso miss for off-scale notes |
| N13 | Track selection model is scalar (`selectedTrackId: string \| null`) | State | Single-ID shape hard-coded throughout | **Medium** — blocks §8.18 and multi-select editing in general |
| N14 | `executeAppAction` merges handlers but `handlers/` + `useCases/*Handlers.ts` both build maps | Command architecture | Mixed layering from an in-progress migration per `AGENTS.md` | **Low** — architectural; makes handler ownership unclear and is a recurring footgun (see §8.1) |
| N15 | WebLLM model-capability check is not centralised | LLM | Whether tools API is supported is encoded per-call instead of on a `ModelCapabilities` map | **Medium** — root cause of lingering §8.2 warning |
| N16 | `getPlatformPlugins()` called multiple times per render in `TrackDevicesSection` | UI perf | Each call walks full catalog; no memoisation (compiler helps with pure components only) | **Low** — cosmetic perf |
| N17 | Zoom shortcut implementations have no path to `preventDefault` on the underlying `KeyboardEvent` | Keyboard | `executeShortcutAction` abstracts the event away before reaching callbacks | **Medium** — root cause of browser-zoom interception in §8.16 |
| N18 | AudioWorklet plugin failures propagate as unhandled promise rejections | Audio engine | No shared `createPluginNodeSafely` wrapper; each `create*Node` throws directly | **High** — core reason plugins fail silently when SAB or WASM is unavailable (§8.19) |

---

## 10. Updated Remediation Plan (Supersedes §5)

### 10.1 — Landmine fixes (ship immediately, very small diffs)

1. §8.8 / N2 — short-circuit duplicate spacebar handling by deleting `shortcutEngine.ts` key binding for `' '` OR adding `stopImmediatePropagation` at the first matcher. One-file change.
2. §8.16 — update `view.zoomIn`/`view.zoomOut` `defaultKeys` to `['mod+=','mod++']` / `['mod+-']` and thread `KeyboardEvent` into `executeShortcutAction` so it can `preventDefault`. Small change touching 3 files.
3. §8.3 follow-up — `startPositionTracking` (Crumbs) must short-circuit when `!isTauri()` instead of entering the 30 Hz poll. Handful of lines.

### 10.2 — Structural fixes (require spec + migration)

1. **Unify the keyboard-shortcut architecture.** Kill the parallel `Workspace/models/Shortcuts.ts` store. Route all shortcuts through `Command/stores/shortcutStore.ts` + one mounted listener. Ties to §8.8 / N1 / N2.
2. **Fix the recording lifecycle contract.** Single source of truth for "which clips are actively recording" (`activeRecordingRef`) and a single finalisation path reachable from every stop trigger (stop button, record toggle, spacebar-pause, escape). Ties to §8.7 / N5.
3. **Multi-recording-session support.** Refactor `AudioEngine/repositories/audioRecorder/recording.ts` to a `Map<trackId, RecordingSession>`. Ties to §8.18 / N4.
4. **Multi-track selection model.** Move `selectedTrackId` → `selectedTrackIds[]` with `primarySelectedTrackId` derived. Ties to §8.18 / N13.
5. **Continuous-control write path.** Replace per-pointer-move `trackStore.set(...)` with a split fast/commit path (ephemeral ref during drag, commit on release) and selector-based subscriptions. Ties to §8.14 / N7.
6. **Plugin node instantiation hardening.** Introduce `createPluginNodeSafely` that catches SAB/WASM init errors, publishes a structured event to the UI, and routes audio around the missing node. Ties to §8.4 / §8.19 / N18.
7. **Centralise environment capability detection.** One module exports `capabilities` = `{ isTauri, hasSharedArrayBuffer, isCrossOriginIsolated, supportsToolsApi }`. All runtime guards consult that module. Ties to §8.2 / §8.3 / §8.4 / N15.

### 10.3 — Feature-gap items (product decisions needed)

- §3.6 "Improve the templates" — product definition blocked.
- §3.10 Delay tempo sync — DSP + UI scope.
- §3.15 Device section IA — UX scope; not a regression.

---

## 11. Recommended New Instrumentation

Beyond §6:

- **Runtime-capability banner at boot:** dismissible UI banner when `!crossOriginIsolated || !SharedArrayBuffer`, listing which plugins will be disabled. Stops the "silent bypass" class of bug dead.
- **Action-dispatch trace via event bus:** every `executeAppAction` publishes `{ type, source, timestamp }` to a bounded ring buffer exposed on `window.__sourdaw_trace__` in dev. Instant triage when shortcuts double-fire or a panel doesn't respond.
- **Recording-lifecycle inspector:** a dev-only overlay showing `activeRecordingRef.current`, `transport.isRecording`, and the recorded clips' `endBeat` values in real time. Makes §8.7 self-diagnosing.
- **Shortcut collision linter:** a module-boot-time check that cross-references `Command/stores/shortcutStore.ts` and any remaining `Workspace` shortcut definitions — throw if the same key descriptor is bound in two places.
- **Write-path profiler:** in dev, wrap `trackStore.set` to track time-to-next-frame and number of downstream re-renders. Emit a warning when a single `set` triggers >N renders in <M ms. Will expose the §8.14 problem and similar ones automatically.

---

## 12. Reproduction Quick-Reference

| Issue | Minimal steps | Expected vs Actual |
| --- | --- | --- |
| §8.7 Recording mirror drift | Start a recording via `transport.toggleRecording`, then trigger any path that calls Arrangement's `stopRecording` without going through Transport (or vice-versa) — or arm no tracks and try to record | `activeRecordingRef` and Transport's `activeRecordingClipIds` should agree. Actually: they can drift, and `buildTimelineRenderModel`'s recording overlay re-appears after stop |
| §8.8 Spacebar | Focus anywhere outside a text input → press Space | Playback should start. Actually: flickers on/off |
| §8.14 Faders | Drag a track gain fader slowly | Value tracks pointer. Actually: stair-steps; catches up on release |
| §8.16 Zoom | Focus timeline → `Cmd +` | Timeline zoom-in. Actually: browser zooms |
| §8.18 Multi-track rec | Arm 2 audio tracks → record | Both buffers captured. Actually: only last-armed track gets audio |

---

## 13. Status Summary

| Status | Issues |
| --- | --- |
| CONFIRMED (root cause found) | §8.4, §8.7 (mirror drift), §8.8, §8.9, §8.12, §8.14, §8.15, §8.16, §8.18 |
| PARTIALLY ADDRESSED (still open) | §8.3 (poll loop still starts on web) |
| PARTIALLY CONFIRMED | §8.2, §8.11, §8.19, §8.20 |
| REFUTED / STALE | §8.1, §8.5 |
| FEATURE GAP (no regression) | §8.6, §8.10 |
| NEW ISSUES SURFACED | §9 (N1–N4, N7, N9, N13–N18) |
| NEW ISSUES SURFACED (Generate panel) | §14 (G1, G2, G6 — plus the residual items in §14.3 / §14.4) |
| DEFERRED — needs spec | §14.1–14.2 / G1+G2 — `MidiNote.startBeat` absolute-vs-relative coordinate unification |

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

1. **`TemplateCard` preview and insert call `template.generate(...)` twice.** `PatternBrowser.tsx:188` renders the mini piano-roll with one result; `handleInsertTemplate` (line 262) re-runs `generate`. Templates like the pattern library's `chordPatterns` / `melodyPatterns` are currently deterministic for a given `(key, scale, density, complexity)` tuple, so the two results match today — but the contract is not enforced. If anyone adds RNG to a template, previews will lie.
2. **Templates that hard-pin `p.scale = 'minor'`.** Several templates in `chordPatterns.ts:66`, `melodyPatterns.ts:34, 107, 150, 170` override the incoming `p.scale` with a hard-coded fallback when `p.scale === 'major'`. If the user picked `major` in the Pattern Browser UI, the template ignores it. This is not a "missing clip" bug but produces notes outside the user's expected scale → perception that "the result looks wrong / unusable".

### 14.4 Tertiary issues

- `addMidiNote` performs one `midiStore.set(...)` per note (`addMidiNote.ts:25-31`). A 48-beat 12-bar blues template with 4 notes per chord × 12 bars = 48 writes for one insert; store subscribers re-render once per write. Not a correctness bug but visibly janky on large templates. `batchAddMidiNotes` already exists and is used by `duplicateClipCore`; both `applyChord/Melody/DrumToTrack` and `PatternBrowser.handleInsertTemplate` should migrate to it.
- `chordFromDegrees` clamps out-of-range degrees with `Math.min(deg + octaveBase, scalePitches.length - 1)` (`scaleTheory.ts:54`). Templates that bump degrees with `complexity > 5` (e.g. `chordPatterns.ts:27 degs[i % 4]![0]! + 7`) silently collapse the "complex" chord back onto the top scale pitch. Does not affect clip visibility; does degrade audible variety.
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
| `src/modules/AiRuntime/models/patterns/melodyPatterns.ts` | 34, 107, 150, 170 | Templates that override `p.scale` (G6) |
| `src/modules/AiRuntime/models/patterns/chordPatterns.ts` | 66 | Another `p.scale` override (G6) |

### 14.6 New issues surfaced (append to §9 mental model)

| ID | Issue | Area | Severity |
| --- | --- | --- | --- |
| G1 | `MidiNote.startBeat` coordinate is inconsistent — absolute in the timeline/renderOffline/duplicate paths, clip-relative in the Piano Roll and user-creation paths; neither contract is documented or tested | MIDI model | **High** — root cause of generator-clip invisibility and a latent foot-gun for any feature that creates clips at `startBeat > 0` |
| G2 | `PatternBrowser.handleInsertTemplate` writes template-local beats as if they were absolute (resolves when G1 lands) | Pattern browser | **High** — direct cause of "empty timeline clip" when playhead > 0 |
| G6 | Templates hard-override `p.scale = 'minor'` when the user selected a different scale | Pattern templates | **Low** — output mismatches user intent |

### 14.7 Remediation direction (not a spec; inputs for one)

1. **Fix the coordinate contract first.** Pick one convention for `MidiNote.startBeat`. The codebase is doing the clip-relative thing in every user-facing MIDI editing path already (click-to-create, drag, step input, chord stamp all use clip-relative beats) — standardise on clip-relative and update the two absolute-convention consumers (`clipDrawing.ts`, `renderOffline.ts`) to **not** subtract `clip.startBeat`. Audit all `note.startBeat + …` arithmetic after the decision. Add a unit test that creates a clip at `startBeat = 8` with a single note at `startBeat = 0`, asserts it renders in both the timeline preview and the piano roll.
   **Scope caveat:** touches `clipDrawing.ts`, `createWebGpuRenderer.ts`, `renderOffline.ts`, `duplicateClipCore.ts`, both AI apply functions, and requires a data migration for existing projects plus hundreds of test fixture updates. Not a quick win — this is the spec item.
2. **Fix the two apply paths to the new convention.**
   - `PatternBrowser.handleInsertTemplate` already writes clip-relative — once step 1 is done, this path is correct.
   - `applyMelodyToTrack` / `applyChordProgressionToTrack` must stop adding `startBeat` to `note.startBeat` and instead let the clip's `startBeat` carry the offset.

   Waits on step 1.
3. **Tighten the template contract.** `PatternTemplate.generate(params)` should honour `params.scale` and never silently replace it; if a template is scale-specific, encode that at the type level (e.g. `scaleOverride: ScaleType`) so the UI can surface "this template forces minor scale" to the user. Covers G6.
4. **Make `addMidiNote` batched end-to-end.** `batchAddMidiNotes` already exists and is used by `duplicateClipCore`. Migrate both `applyChord/Melody/DrumToTrack` and `PatternBrowser.handleInsertTemplate` to it so one insert emits a single `midiStore.set(...)`. Removes the per-note render storm from both apply paths.
5. **De-duplicate the `TemplateCard` preview/insert generation.** Generate once, keep the result in state, reuse it on insert. Makes the template contract honest even when templates become stochastic.
