# Comprehensive Systemic Issues Root-Cause Audit

## 1. Executive Summary

This audit tracks the open strands from an original report of 20 distinct systemic issues across the Sourdaw codebase: audio engine / plugin lifecycle, transport and MIDI model, editor interaction, fader write paths, recording lifecycle, and keyboard / coordinate handling. A number of these items have been fully resolved and their detail has been deleted from this document — the audit is a forward-looking state document, not a history of fixes. The remaining items cluster around four systemic themes:

- **Decoupled Transient UI State vs DSP/Engine State.** Faders drag continuously but the write path fans the update out to every subscriber of `trackStore`; any heavy subscriber stalls the next pointer-move. Applies to §8.14 and §8.20 engine-side verification.
- **Single-owner assumptions that break under multi-track operations.** Track selection is scalar (`selectedTrackId`); audio recording holds a single `RecordingSession`. Arming multiple tracks silently drops all but the last. §8.18 / N4 / N13.
- **Plugin-hosting contract gaps.** SAB-missing is now typed and routed around, but other failure families (WASM fetch, worklet registration, handshake timeout) still throw bare `Error`. §8.19 Crust is a separate class entirely: missing DSP implementation, no strategy registration, silent add.
- **MIDI coordinate-space inconsistencies.** `MidiNote.startBeat` is interpreted as absolute in the timeline/offline/duplicate paths and as clip-relative in the piano-roll / user-creation paths. Surfaces as "empty clip on the timeline" or "empty piano roll" when a clip's `startBeat > 0`. §14 / G1+G2, tied to §8.11 / §8.12 off-scale lasso via the fold-contract decision.

Everything below is scoped to items that are still actionable or deferred. Sections for fixes that have already landed have been removed; the task files under `.agents/tasks/` hold the per-session record.

---

## 2. Open Issue Inventory

| Issue                                                         | Symptom                                                             | Subsystem                       | Status reference                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------- | --------------------------------------- |
| 2. WebLLM model mismatch                                      | `UnsupportedModelIdError: Qwen3-4B-q4f16_1-MLC is not supported...` | AI rundo antime                 | §8.2 — surveillance                     |
| 4. SharedArrayBuffer / CORS failures (dev-env only)           | `[WebAudioEngine] Grand Boule failed: SharedArrayBuffer...`         | WebAssembly, audio engine       | §8.4 — dev-server + Tauri header parity |
| 6. "Improve the templates"                                    | Standalone product note                                             | UI, asset-loading               | §8.6 — product decision                 |
| 10. Delay timing tempo snapping                               | Need delay option to snap time 1/1 to 1/64th                        | Audio engine, UI                | §8.10 — feature gap                     |
| 11. Chord helper notes non-expandable under fold              | Off-scale chord notes disappear from hit-test                       | MIDI model, UI                  | §8.11 — fold-contract decision          |
| 12. MIDI lasso under fold                                     | Off-scale notes still missed by the rubber-band                     | MIDI model, rendering           | §8.12 — tied to §8.11                   |
| 14. Faders snap on release                                    | Dragging unresponsive; catches up on mouse up                       | UI, state-management            | §8.14 — write-path storm                |
| 15. TrackDevicesSection menu huge                             | Inspector shows all effects in a flat list                          | UI, rendering                   | §8.15 — UX scope                        |
| 16. Timeline minimap non-resizable                            | Fixed 28px, no drag handle                                          | Layout                          | §8.16 — feature gap                     |
| 17. Levain plugin boot time on large banks                    | Main thread backpressure on transferable-buffer queue               | Asset loading, plugin lifecycle | §8.17 — speculative                     |
| 18. Multi-track selection missing (+ multi-session recording) | Single `selectedTrackId`; single `RecordingSession`                 | State-management, audio engine  | §8.18 — structural                      |
| 19. Crust silent                                              | Device adds, knobs move, audio unchanged                            | Audio engine, plugin lifecycle  | §8.19 — missing DSP implementation      |
| 20. Proof parametric EQ — engine-side verification            | Parameter change from UI not yet confirmed end-to-end               | Audio engine, UI                | §8.20 — needs XOI run                   |

Items not listed here (original issues 1, 3, 5, 7, 8, 9, 12 center-point, 13, 16 zoom, 19 Gluten/Proof) were fully resolved and removed from this audit. Their root causes and fix details live in the associated task file(s) under `.agents/tasks/`.

---

## 3. Original report — open items only

> This section preserves the user's original symptom descriptions for the still-open items, one per subsection. Closed items have been removed.

### 2) WebLLM model mismatch for add MIDI completion feature

- **Symptom:** `[DEV][WARN] [WebLLM] Tool call API failed: UnsupportedModelIdError: Qwen3-4B-q4f16_1-MLC is not supported for ChatCompletionRequest.tools...`
- **Constraint:** Do not use WebLLM for add MIDI completion unless using the current setup with Qwen.
- **Hypotheses:** Code expected a tool-calling API the MLC model does not support. An outdated feature path may still be wired in a vendored / stale build.

### 4) SharedArrayBuffer / cross-origin isolation failures

- **Symptom:** `[WebAudioEngine] Grand Boule failed: SharedArrayBuffer is not available...`, plus `ReferenceError: SharedArrayBuffer is not defined` for Gluten and Proof.
- **Hypotheses:** Dev server or Tauri webview not serving COOP/COEP. Plugins mandate SAB for IPC/WASM memory but historically failed to degrade.

### 6) "Improve the templates"

- **Symptom:** Standalone note `Improve the templates`.
- **Actionable path:** Identify the primary "template" concepts (Project vs Track vs Plugin) and clarify the requirement with design.

### 10) Delay timing should support tempo snapping from 1/1 to 1/64

- **Symptom:** Delays need an option to snap time to tempo from `1/1` to `1/64`.
- **Actionable Path:** Introduce a note-division enum and a UI "Tempo Sync" toggle on delay-based effects.

### 11) MIDI editor chord helper notes cannot be expanded or manipulated properly

- **Symptom:** Notes added via the chord helper (3 notes at once) are non-expandable and unselectable.
- **Note:** Original hypotheses (missing IDs, transient grouped entities) were refuted by code evidence; see §8.11 for the real remaining issue under fold/scale-lock.

### 12) MIDI editor lasso selection

- **Symptom:** Lasso misses notes under fold even when enclosed.
- **Note:** Center-point and rectangle-drag paths were fixed; only the off-scale-under-fold strand remains, tied to §8.11.

### 14) Faders move incorrectly and snap only on mouse release

- **Symptom:** Dragging faders doesn't respond; they snap into position on mouse release.
- **Hypotheses:** Continuous `onChange` commits to global store; store fanout blocks rendering until the pointer halts.

### 15) `TrackDevicesSection.tsx` inspector UI needs reorganization

- **Symptom:** Shows all effects in a huge menu; needs navigation / collapsible layout.
- **Actionable Path:** Decompose into categorised accordions + a search filter.

### 16) Timeline minimap resizing

- **Symptom:** Minimap non-resizable.
- **Note:** Zoom-key path was fixed; minimap resize is a feature gap.

### 17) Levain plugin takes too long to boot

- **Symptom:** Takes ages to boot; some sample 404s.
- **Hypotheses:** The boot sequence may queue dozens of MBs of MessagePort backpressure without ack-based flow control (see §8.17).

### 18) No multi-track selection support

- **Symptom:** No way to select multiple tracks (e.g., to delete 5 at once). Additionally, arming more than one audio track only records the last.

### 19) Crust produces no audible effect

- **Symptom:** No difference in sound. (Gluten/Proof's variant of the original report — SAB-missing silence — is resolved; Crust is a distinct class of issue, see §8.19.)

### 20) Pro parametric EQ — engine verification

- **Symptom:** Knobs in the EQ UI move; we have not yet confirmed, under cross-origin isolation, that the parameter change reaches the worklet.

---

## 4. Cross-Issue Pattern Analysis

Patterns still driving open issues:

1. **Decoupled Transient UI State vs DSP/Engine State**
    - Open issues: §8.14 (faders), §8.20 (Proof engine-side verification).
    - Cause: continuous-control writes fan out through the central store; rendering subscribers stall future pointer events.
2. **Single-owner assumptions**
    - Open issues: §8.18 (selection + recording).
    - Cause: scalar `selectedTrackId`, single `RecordingSession` — both break under multi-track operations.
3. **Plugin-hosting contract gaps**
    - Open issues: §8.19 (Crust missing DSP implementation; other failure families still throw bare `Error`).
4. **MIDI coordinate-space inconsistencies**
    - Open issues: §14 / G1+G2, linked to §8.11 / §8.12 off-scale decision.

---

## 5. Recommended Instrumentation Additions

Instrumentation items still worth adding (items that already landed have been deleted from this list):

- **Recording-lifecycle inspector.** Dev-only overlay showing `activeRecordingRef.current`, `transportStore.isRecording`, and recorded clips' `endBeat` in real time. The drift invariant in `buildTimelineRenderModel` already surfaces a warn on mismatch; the overlay would let a human see drift visually rather than waiting for the warn.
- **Write-path profiler.** In dev, wrap `trackStore.set` to track time-to-next-frame and count downstream re-renders. Emit a warning when a single `set` triggers > N renders in < M ms. Would expose §8.14 and similar problems automatically.
- **Coordinate hit-test debugger.** A dev flag to draw bounding boxes for lasso/rectangle selection intersections in the MIDI editor overlay — will help validate any fix under §8.11 / §8.12.

---

## 6. Open Questions / Unknowns Blocking Diagnosis

- **WebLLM architecture.** What is the intended role of WebLLM in the "add MIDI completion" feature given that the current Qwen MLC model does not support tool calling? Product owns the answer: parse plain text or migrate back to a tool-supported model? (§8.2)
- **"Improve the templates."** Needs product definition. What templates? Where? (§8.6)
- **Crust DSP backend.** Faust / native (Rust + AudioWorklet) / pure Web Audio — each has distinct fidelity and cross-origin-isolation tradeoffs. Depends on whether the full parameter set in `CRUST_DESCRIPTOR` (true-peak, lookahead, oversampling 1–32×, multi-band) is considered in-scope for the first implementation. (§8.19)

---

## 7. Prioritized Remediation Plan

Superseded by §10. Kept as a numbered gap so stable §8.x / §10 / §13 / §14 cross-references continue to resolve.

---

## 8. Validated Root-Cause Analysis (Code-Level Findings)

> Each subsection below is the deep analysis for an open item. Items whose fix has landed have been deleted — see the relevant task file under `.agents/tasks/`.

### 8.2 — WebLLM `UnsupportedModelIdError` on Qwen3 — OPEN (surveillance only)

- **Call-site audit:** Every `tools:` literal in `src/` was inspected. `src/modules/AiRuntime/repositories/webLlm/toolCalling.ts` routes around the unsupported API via `parseToolCallXml`. `src/modules/AiRuntime/repositories/cloudLlm/cloudInference/generateCloudToolCalls.ts` sends `tools:` only to cloud backends. No MLC-bound call site attaches `tools:` today, so the warning originates inside a third-party dependency or a stale build.
- **Capability gate:** `src/utils/capabilities.ts` exposes `supportsToolsApi(modelId)` with an explicit allow-list (empty for MLC models). Any future WebLLM call site considering the native `tools` path must gate behind that helper.
- **Surveillance:** `generateWebLlmCompletion` logs `[WebLLM] completion model=<id> keys=<sorted payload keys>` on every invocation (payload contents intentionally **not** logged — token cost). If the error recurs, the preceding log line names the model and shows whether `tools` is in the payload keys.
- **Close criteria:** if logs over a representative usage window never contain `tools` in `keys=`, the original audit entry is a stale build artefact and can be closed. If they do, the call site is inside WebLLM itself and the fix becomes a dependency pin or patch.

### 8.4 — SharedArrayBuffer / CORS — dev-env and Tauri parity still open

- **Evidence:**
    - `vite.config.ts:25-28` and `:84-87` set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for `server` and `preview`.
    - `src/modules/AudioEngine/engine/GrandBouleNode.ts:84-90` hard-throws when `typeof SharedArrayBuffer === 'undefined'` (now routed via `requireSharedArrayBuffer` / `PluginRequiresIsolationError`).
- **Why the error still recurs in practice:**
    1. **Stale build cache:** Vite may serve a cached `index.html` without headers after config change. Kill and restart dev server after editing `vite.config.ts`.
    2. **Tauri webview:** `src-tauri/tauri.conf.json` may not mirror the COOP/COEP headers. Unverified — this is the concrete remaining task.
    3. **Cross-origin embedded resources:** COEP `require-corp` refuses any embedded subresource without a matching `Cross-Origin-Resource-Policy` header. Same-origin WASM/sample fetches are fine; any third-party CDN (e.g. WebLLM model shards) would trip this.
- **Remaining work:**
    1. Verify and (if missing) mirror COOP/COEP in `src-tauri/tauri.conf.json` under `app.security.headers`.
    2. For WebLLM: ensure model shards come from the same origin or use CORP-enabled hosting.

### 8.6 — "Improve the templates"

- Pure product note. No code evidence to gather. Requires a decision: project-level vs. track-preset vs. plugin-patch templates.

### 8.10 — Delay tempo-sync — feature gap

- Confirmed as a genuine feature gap — no code exists for note-division sync in `src/modules/AudioEngine/repositories/devices/reverbDelay/`. Requires product scope + DSP parameter design.

### 8.11 — Chord helper notes cannot be expanded under fold — needs fold-contract decision

- **Invalidated original claims:** the hypotheses in the initial report were refuted by a re-read of `usePianoRollInteractions.ts` and `usePianoRollRenderer.ts`:
    - "Chord-mode click on existing note creates another chord" — `hitTest` runs before the chord-mode branch in `handleMouseDown`; if the click lands on a visible note, the `if (hit)` branch routes into select/move/resize regardless of chord-mode state. The chord-mode stamp only fires on empty-area clicks. Not a bug.
    - "Notes are drawn faded but not hit-testable" — the renderer's `drawActiveNotes` loop does `if (row === -1) continue;` (see `usePianoRollRenderer.ts:537-540`). Off-scale notes under fold are **hidden entirely**, not faded. The user cannot click something they cannot see, so the hit-test filter is not the bug.
- **Real remaining bug:** when fold/scale-lock is active, off-scale chord helper notes (the 3rd and 5th that fall outside the current scale) disappear from both the renderer and the hit-test. The user cannot select, move, or resize them without first toggling fold off.
- **Why this cannot ship as a quick win:** the fix couples rendering and coordinate space. Options:
    1. Include every pitch that has a note in the visible-pitch set — rendering, hit-testing, keyboard sidebar, and row ruler all derive off the same set. Keyboard needs a visual indicator that some rows are "off-scale, present because of notes".
    2. Render off-scale notes at the nearest scale row with an off-scale glyph — preserves compact fold but loses pitch fidelity.
    3. Disable fold automatically whenever an off-scale note exists. Aggressive but simple.
- Any of these is a multi-file, UX-reviewed change. Parked under the §14 / G1 coordinate spec as a linked decision — resolve the coordinate convention and the fold contract together.

### 8.12 — Off-scale lasso miss — tied to §8.11

- Off-scale notes under fold have `visiblePitches.indexOf(note.pitch) === -1`, so they are skipped from the lasso loop even if the polygon encloses them. Same filter as the fold-rendering path — they aren't drawn either. Resolving this requires the fold-contract decision from §8.11, not a new lasso pass.

### 8.14 — Faders snap on release — write-path storm

- **Evidence chain per drag event:**
    1. Radix `Slider` emits `onValueChange` on every pointer-move (continuous).
    2. `src/modules/Workspace/presentations/views/Inspector/TrackLevelSection.tsx:39-47` calls `setTrackGain(track.id, v/100)` synchronously.
    3. `src/modules/Arrangement/useCases/setTrackGainPan/setTrackGain.ts:9-15` does four things per call:
        - `updateTrack(...)` → `trackStore.set(...)` → fans out to every subscribing view (Inspector, Mixer, TimelineSurface, automation lanes, etc.).
        - `engineSetTrackGain(...)` → Web Audio gain node write.
        - `syncToasterPadParam(...)` → additional device param write if Toaster is present.
        - `maybeRecordAutomation(...)` → automation point recording.
- **Why this looks like "snaps on release":** `trackStore.set(...)` triggers a re-render of every subscriber; some subscribers (TimelineSurface canvas redraw, mixer meters) can take > 16 ms, long enough that the main thread misses subsequent pointermove events. The Slider's controlled value then lags, producing a stair-step visual where the thumb only catches up when pointer events cease and the store finally quiesces.
- **Fix direction — two options, not mutually exclusive:**
    1. **Split fast vs. commit path.** During drag, update a local ref + thumb position directly; only commit to `trackStore` on `onValueCommit` (Radix emits this on pointer-up). Engine writes can still be throttled via `requestAnimationFrame` so audio stays smooth.
    2. **Decouple rendering from store fanout.** Timeline and mixer meters should not subscribe to the full track object — they should subscribe to the specific fields they read (via selectors) and bail out on shallow-equal updates. Broader write-path audit that affects faders, pan knobs, sends, and device params uniformly.
- Solve systemically, not per-control.

### 8.15 — `TrackDevicesSection` menu huge — UX scope

- **Evidence:** `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx` renders three categorised lists (`effect` / `utility` / `analyzer`) plus a flat `scannedPlugins` external list. No search filter, no accordion structure.
- **Fix direction:** Decompose into accordions by category, add a search input across all lists (user-installed and external), and virtualise the external list when it grows beyond a few dozen entries. UX scope — not a regression.

### 8.16 — Minimap resize — feature gap

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx` renders at fixed `MINIMAP_HEIGHT = 28px` with no drag-handle on any edge. The viewport rectangle is click-to-jump and drag-to-scroll only. Not a regression — it is a missing feature. Can be made resizable by adding a top-edge `DragResizeHandle` that writes a `preferencesStore` key (analogous to `mixerHeight`).

### 8.17 — Levain — Bug C (speculative, measure first)

- **Bug C (memory pressure).** The transferable-buffer path sends each decoded sample to the worklet with `postMessage([transferable])`, and the browser transfers ownership. But the same buffer is first held in `fetchAndDecode` — if the worklet processor is slow to acknowledge (no ack flow exists), the main thread can queue dozens of MBs of MessagePort backpressure. Consider ack-based flow control for large banks. Not a confirmed correctness bug — measure first before shipping; it is a hidden cause of "ages to boot" on slow machines.

### 8.18 — Multi-track selection missing — confirmed + recording bug

- **Evidence (selection model):** `src/modules/Arrangement/stores/trackStore.ts:22-28` models selection as a singular `selectedTrackId: string | null`. No `selectedTrackIds: Set<string>`. Every consumer of track selection (Inspector, automation lanes, deletion commands) reads the single ID.
- **Secondary finding (MAJOR — multi-track _audio recording_ is broken):** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:36-63` holds a single `recordingSession: RecordingSession` via `createHmrPersistentState`. There is exactly one `mediaStream`, one `sourceNode`, one `recordingNode`, and one `onRecordingComplete`. When `toggleRecording` loops over multiple armed audio tracks (`src/modules/Transport/useCases/transportControls/toggleRecording.ts:27-59`) and calls `startAudioRecording(trackId, ...)` once per track, **each successive call overwrites the previous session's state** — the previous track's `onRecordingComplete` is orphaned, its worker keeps filling a SAB that no one reads, and only the last-armed track actually produces a buffer on stop.
- **Fix direction:**
    1. Refactor track selection to `selectedTrackIds: string[]` (ordered) with `primarySelectedTrackId` derived (last click). Every consumer must migrate simultaneously — this is a bulk refactor best done under a proper spec.
    2. Refactor `recording.ts` to hold `recordingSessions: Map<trackId, RecordingSession>` so multiple tracks record into independent rings. Each `stopAudioRecording` stops its own session; a `stopAllAudioRecording` convenience exists for the common "stop everything" path.
    3. Treat these as two independently-landed milestones, with the recording fix gated on the new session map (not on the selection refactor).

### 8.19 — Crust silent — missing DSP implementation

> **Typo correction (carried through §2 and the issue table):** the original report wrote "Curst". The plugin's name in the codebase is **Crust** (`src/modules/Crust/...`, `CRUST_DESCRIPTOR`). The hypothesis that it was a routing / wet-dry bug in the same family as §8.20 is **wrong** and superseded by the evidence below. The Gluten / Proof SAB-silence strand of the original report is resolved and lives in the task file; only Crust remains open here.

- **Crust has no DSP implementation.** Searched the entire repo (`src/`, `src-tauri/`, `crates/`) for any engine-side Crust node, worklet, Faust module, or Rust crate — **none exists**. The Crust module ships a complete front-end stack (`src/modules/Crust/stores/`, `src/modules/Crust/useCases/crustParamBridge/`, `src/modules/Crust/presentations/`, presets, waveform display, metering strip, param batcher, panel open/close handlers), and `CRUST_DESCRIPTOR` (`src/modules/Arrangement/models/pluginDescriptors/crustDescriptor.ts`) is included in `BUILTIN_PLUGINS` with `id: 'crust'`, so the plugin is addable from the effects tab.
- **Two dispatch tables, both fail.** On the engine side, two independent dispatch tables have to resolve the type:
    - (a) `TrackNode.addDevice` (`src/modules/AudioEngine/engine/TrackNode.ts`) — consults `DEVICE_FACTORIES` for the `builtin-*` family then falls through to `findWasmDescriptor` (`src/modules/AudioEngine/engine/wasmDeviceRegistry.ts`).
    - (b) `DeviceFactoryRegistry` in `setupDeviceStrategies.ts` — used by the offline render / rebuild path.
- `'crust'` matches **nothing** in either: it has no `builtin-` prefix (so skips `DEVICE_FACTORIES` and the `'builtin-'` strategy matcher), is absent from `wasmDeviceRegistry`'s matchers list (`isFermenterDevice` / `isToasterDevice` / `isLevainDevice` / `isGlutenDevice` / `isBacteriaDevice` / `isGrinderDevice` / `isProofDevice` / `isProofChamberDevice` / `isScoringDevice` / `isGrandBouleDevice` / `isFaustModule`), and is not a Faust module (no `registerPluginLoader('crust', …)` anywhere).
- **Concrete sequence:**
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
        - Register a "not-implemented" strategy for `'crust'` that throws a typed `PluginNotImplementedError`, and teach `buildDeviceChain`'s catch block to emit a toast (mirroring the `PluginRequiresIsolationError` pattern).
        - Tag `CRUST_DESCRIPTOR` with a new `unavailableReason: 'not-implemented'` field and have `EffectsTab` disable the entry with an explanatory tooltip.
        - Move `CRUST_DESCRIPTOR` out of `BUILTIN_PLUGINS` into a `PENDING_PLUGINS` list so it never reaches the picker. Least-friction, but loses the front-end work visually.
    3. **Audit all other descriptors in `BUILTIN_PLUGINS` against both dispatch tables.** Any descriptor whose `id` matches neither `DEVICE_FACTORIES` + `wasmDeviceRegistry` (live path) nor `DeviceFactoryRegistry` (render path) is a silent-add plugin. `Crumbs` (`CRUMBS_DESCRIPTOR`, `id: 'builtin-crumbs'`) is the next likely candidate: its `builtin-` prefix wins the `DeviceFactoryRegistry` matcher, but `DEVICE_FACTORIES['builtin-crumbs']` is undefined and its runtime state is driven entirely by `tauriInvoke('create_crumbs', …)` (`src/modules/Crumbs/repositories/crumbsBridge.ts`). On web, `createCrumbsInstance` short-circuits to a no-op and the UI is wired to a non-existent engine — same end state as Crust. Confirm and either tag `platform: 'native'` in the descriptor, or give it a web-side fallback.

### 8.20 — Proof (parametric EQ) engine-side verification

- The UI double-dispatch and boolean-encoding problems have been fixed; the remaining verification work is engine-side.
- **Not yet verified:** the `onSendParam` → `ProofNode.postMessage` → AudioWorklet parameter setter chain has not been audited at the worklet side. If `ProofNode` instantiation fails (most commonly the SAB-missing case, now typed) the UI still sends events to a dead MessagePort. Concrete next step: confirm, under cross-origin-isolated conditions, that a param change in the UI produces the matching DSP change.
- **Known UI quirk (not a bug):** `ProofEqCurve` only drags `freq` (X) and `gain` (Y); Q is only mutated via the per-band knob strip. The draggable dot on the curve does not move when Q changes — only the peaking-magnitude curve does. Document this in the UX copy if users get confused.

---

## 9. New Issues Surfaced During Investigation (still open)

Regressions / anti-patterns the walk-through found that the original issue list did not list explicitly. Items closed during the audit-driven work have been removed.

| #   | Symptom                                                                                                                                                                                  | Subsystem            | Severity                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N4  | Single `recordingSession` prevents true multi-track audio recording                                                                                                                      | Audio recording      | **High** — breaks core DAW feature under "arm multiple tracks"                                                                                         |
| N7  | `trackStore.set(...)` write-path fans out to every subscriber per pointer-move for continuous controls                                                                                   | State / rendering    | **Medium** — perf root cause of §8.14; pattern also affects pan knobs, sends, device params                                                            |
| N9  | Visibility-filtered pitches (`getVisiblePitches`) gate rendering, hit-testing, lasso and rectangle selection uniformly; off-scale notes under fold disappear from every interaction path | MIDI editor          | **Medium** — last remaining barrier to selecting chord-helper 3rd/5th notes under scale-lock. Requires a fold-contract UX decision (see §8.11 options) |
| N13 | Track selection model is scalar (`selectedTrackId: string \| null`)                                                                                                                      | State                | **Medium** — blocks §8.18 and multi-select editing in general                                                                                          |
| N14 | `executeAppAction` merges handlers but `handlers/` + `useCases/*Handlers.ts` both build maps                                                                                             | Command architecture | **Low** — architectural; makes handler ownership unclear and is a recurring footgun                                                                    |

---

## 10. Remediation Plan

### 10.1 — Structural fixes (require spec + migration)

1. **Fix the recording-session model.** Refactor `AudioEngine/repositories/audioRecorder/recording.ts` to a `Map<trackId, RecordingSession>`. Ties to §8.18 / N4. Independent of the selection refactor — can ship first.
2. **Multi-track selection model.** Move `selectedTrackId` → `selectedTrackIds[]` with `primarySelectedTrackId` derived. Ties to §8.18 / N13. Bulk refactor; every consumer (Inspector, automation lanes, deletion, sidebar) migrates simultaneously.
3. **Continuous-control write path.** Replace per-pointer-move `trackStore.set(...)` with a split fast/commit path (ephemeral ref during drag, commit on release) and selector-based subscriptions. Ties to §8.14 / N7. Applies uniformly to faders, pan knobs, sends, and device param knobs — pick one control as the pilot, then generalise.
4. **Plugin node instantiation hardening — remaining families.** The SAB-missing class is handled. Generalise to a `createPluginNodeSafely` wrapper that also catches WASM fetch failures, AudioWorklet registration errors, and handshake timeouts — publishing each as a structured, typed error with its own toast mapping. Not urgent; reach for this when the second failure family appears in a bug report.
5. **Crust DSP backend.** Decide Faust / native / Web Audio; see §8.19 fix direction. Also audit the rest of `BUILTIN_PLUGINS` for other descriptors that silent-add — Crumbs is the immediate suspect.
6. **`MidiNote.startBeat` coordinate unification.** See §14. Standardise on clip-relative; update the two absolute-convention consumers; add a unit test that exercises `startBeat > 0`; plan a data migration for existing projects.

### 10.2 — Landmine fixes (small, can be scheduled independently)

- **§8.4 Tauri header parity** — verify and (if needed) mirror COOP/COEP in `src-tauri/tauri.conf.json`. Sub-hour if the config is straightforward.
- **§8.19 interim surfacing** — register a `PluginNotImplementedError` + toast path for Crust (and any other silent-add descriptors found by the audit in 10.1 item 5). Trades silent breakage for a diagnosable error.

### 10.3 — Feature-gap items (product decisions needed)

- §8.6 "Improve the templates" — product definition blocked.
- §8.10 Delay tempo sync — DSP + UI scope.
- §8.15 Device section IA — UX scope; not a regression.
- §8.16 Minimap resize affordance — UX scope; not a regression.
- §8.17 Levain Bug C — speculative optimisation; measure first.

---

## 11. Reproduction Quick-Reference

| Issue                 | Minimal steps                                                   | Expected vs Actual                                                                                                      |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| §8.14 Faders          | Drag a track gain fader slowly                                  | Value tracks pointer. Actually: stair-steps; catches up on release                                                      |
| §8.18 Multi-track rec | Arm 2 audio tracks → record                                     | Both buffers captured. Actually: only last-armed track gets audio                                                       |
| §8.19 Crust silent    | Add Crust to a track → play                                     | Audio processed by Crust. Actually: bit-identical to no device inserted; no log on the live path                        |
| §14 / G1              | Create a clip at `startBeat = 8`, insert notes via Patterns tab | Notes visible in both timeline preview and piano roll. Actually: empty in one of the two views depending on insert path |

---

## 12. Recommended New Instrumentation (landed items removed)

Merged into §5. Kept as a numbered gap so stable §13 / §14 cross-references continue to resolve.

---

## 13. Status Summary

| Status                                   | Issues                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CONFIRMED — root cause found, needs spec | §8.14, §8.18 (+ N4, N7, N13)                                                                                                     |
| OPEN — surveillance only                 | §8.2 (close once logs confirm no `tools` in payload keys)                                                                        |
| OPEN — needs further code work           | §8.4 Tauri header parity                                                                                                         |
| PARKED — needs fold-contract decision    | §8.11, §8.12 off-scale lasso miss, N9                                                                                            |
| MISSING IMPLEMENTATION — needs spec      | §8.19 Crust (front-end ships, engine-side DSP does not exist; also audit `BUILTIN_PLUGINS` for siblings like Crumbs)             |
| PARTIALLY CONFIRMED                      | §8.20 engine-side worklet param wiring (verifiable once under cross-origin-isolated conditions)                                  |
| UX / FEATURE SCOPE (not a regression)    | §8.6, §8.10, §8.15, §8.16 minimap resize affordance, §8.17 Bug C (speculative)                                                   |
| DEFERRED — needs spec                    | §14.1–14.2 / G1+G2 — `MidiNote.startBeat` absolute-vs-relative coordinate unification (also unblocks the fold-contract decision) |
| ARCHITECTURAL — low priority             | N14                                                                                                                              |

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
  `PatternBrowser.tsx:275 addMidiNote(clip.id, note.pitch, note.startBeat, ...)` passes the template-local beat (0..`lengthBeats`) unchanged. `addMidiNote` (`src/modules/MIDI/useCases/midiNoteCrud/addMidiNote.ts:19`) clamps `safeStart = Math.max(0, startBeat)` and stores as absolute. With playhead at beat 8, `clip.startBeat = 8`, notes stored at absolute beats 0..16, renderer computes `relStart = 0 - 8 = -8`, fails the `relStart + duration > 0` guard for most notes → timeline clip preview is blank. Double-clicking the clip opens Piano Roll, which uses clip-relative math, so notes _are visible there_, producing a confusing "timeline empty, editor full" state.
- **AI chord/melody action produces a clip that looks empty when opened in Piano Roll.**
  `applyMelodyToTrack` / `applyChordProgressionToTrack` pass `startBeat + note.startBeat`, which is the absolute beat. Timeline preview computes `relStart = note.startBeat` correctly. But Piano Roll renderer draws at `x = (startBeat + note.startBeat) * beatWidth`, so when playhead = 8 beats, every note is offset 8 beats to the right of the roll's left edge; in a typical view that scrolls the notes completely off screen → user sees a clip with "no notes" in the piano roll while the timeline preview is fine.
- **Depending on which view the user is focused on at insert time, the same bug presents either as "empty clip on timeline" or "empty piano roll".** Matches both halves of the report.

### 14.3 Secondary issues

- `generateChordProgression` respects `rhythm = 'whole'` as the default, yielding one downbeat note per bar (`algorithm.ts:158-160`). Combined with the absolute-vs-relative rendering bug above, the total count of visible notes in a 4-bar pop progression can be as low as 4 × 3 = 12 and all of them can be hidden. The "one note per bar" default is worth revisiting as a UX choice once G1 lands.

### 14.4 Evidence — exact file:line references

| Path                                                                         | Line(s)            | What it shows                                                              |
| ---------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `src/modules/AiRuntime/presentations/views/PatternBrowser.tsx`               | 249–280            | Insert handler; raw `note.startBeat` passed to `addMidiNote` (G2)          |
| `src/modules/MIDI/useCases/midiNoteCrud/addMidiNote.ts`                      | 17–22              | Clamping rules; ambiguity over whether `startBeat` is absolute or relative |
| `src/modules/Arrangement/useCases/clip/addClip.ts`                           | 26–46              | No overlap check, no side-effect on selection                              |
| `src/modules/Arrangement/presentations/renderers/clipDrawing.ts`             | 340–369            | Timeline preview uses **absolute** convention (G1)                         |
| `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts`             | 43                 | Offline renderer uses **absolute** convention (G1)                         |
| `src/modules/Arrangement/useCases/clip/duplicateClipCore.ts`                 | 42                 | Duplicate uses **absolute** convention (G1)                                |
| `src/modules/Workspace/presentations/hooks/usePianoRollRenderer.ts`          | 467                | Piano Roll uses **clip-relative** convention (G1)                          |
| `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts`      | 318, 340, 545, 693 | User-created notes are inserted with clip-relative beats (G1)              |
| `src/modules/AiGeneration/useCases/generateMelody/applyToTrack.ts`           | 14–31              | Adds `startBeat` to `note.startBeat` — will double-offset once G1 lands    |
| `src/modules/AiGeneration/useCases/generateChordProgression/applyToTrack.ts` | 18–36              | Same pattern                                                               |

### 14.5 New issues surfaced

| ID  | Issue                                                                                                                                                                                                       | Area            | Severity                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `MidiNote.startBeat` coordinate is inconsistent — absolute in the timeline/renderOffline/duplicate paths, clip-relative in the Piano Roll and user-creation paths; neither contract is documented or tested | MIDI model      | **High** — root cause of generator-clip invisibility and a latent foot-gun for any feature that creates clips at `startBeat > 0` |
| G2  | `PatternBrowser.handleInsertTemplate` writes template-local beats as if they were absolute (resolves when G1 lands)                                                                                         | Pattern browser | **High** — direct cause of "empty timeline clip" when playhead > 0                                                               |

### 14.6 Remediation direction (not a spec; inputs for one)

1. **Fix the coordinate contract first.** Pick one convention for `MidiNote.startBeat`. The codebase is doing the clip-relative thing in every user-facing MIDI editing path already (click-to-create, drag, step input, chord stamp all use clip-relative beats) — standardise on clip-relative and update the two absolute-convention consumers (`clipDrawing.ts`, `renderOffline.ts`) to **not** subtract `clip.startBeat`. Audit all `note.startBeat + …` arithmetic after the decision. Add a unit test that creates a clip at `startBeat = 8` with a single note at `startBeat = 0`, asserts it renders in both the timeline preview and the piano roll.
   **Scope caveat:** touches `clipDrawing.ts`, `createWebGpuRenderer.ts`, `renderOffline.ts`, `duplicateClipCore.ts`, both AI apply functions, and requires a data migration for existing projects plus hundreds of test fixture updates. Not a quick win — this is the spec item.
2. **Fix the two apply paths to the new convention.**
    - `PatternBrowser.handleInsertTemplate` already writes clip-relative — once step 1 is done, this path is correct.
    - `applyMelodyToTrack` / `applyChordProgressionToTrack` must stop adding `startBeat` to `note.startBeat` and instead let the clip's `startBeat` carry the offset.

    Waits on step 1.
