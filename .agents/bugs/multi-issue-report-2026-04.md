# Multi-issue bug report (pre-investigation)

**Status:** Open — investigation notes only; **no fixes applied** in this document.  
**Date:** 2026-04-11

---

## Summary

| Area | Count |
|------|-------|
| UI / timeline / automation | 4 |
| MIDI / playback | 2 |
| Device / inspector / panels | 2 |
| Audio engine / Faust / telemetry | 4 |
| Browser / deployment / canvas | 3 |
| Performance (audit) | 1 (dedicated section) |

---

## 1. Automation panel: vertical scroll mismatch (track list vs lanes)

**Symptom:** In the automation section, the left column (track / lane labels) scrolls independently of the main automation lane area, so rows drift out of alignment. Expected: same behavior as the main timeline — one vertical scroll for the combined surface.

**Preliminary cause:**

- `AutomationBottomPanel.tsx` uses a **two-column grid** with:
  - Left: `AutomationSidebarCell` with **`overflow-y-auto`** wrapping lane label rows (approx. L248–291).
  - Right: lane canvas area in **`overflow-y-auto`** (approx. L296–298).
- Two independent scroll containers with **no shared `scrollTop` ref** or scroll-sync handler → **classic split-pane drift**.

**Files to touch (when fixing):** `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`, possibly `AutomationLaneRow.tsx` if structure changes.

---

## 2. Moving playhead “crops” freshly recorded MIDI clips

**Symptom:** After recording MIDI, moving the playhead appears to **trim or crop** clips incorrectly.

**Preliminary cause (hypotheses):**

- **Scheduling vs clip bounds:** `Transport` / `scheduleAudioClips` / MIDI scheduling may re-derive clip `startBeat`/`endBeat` from playhead or loop bounds on seek.
- **Undo/preview:** Record pipeline might leave clips in a **preview** state until commit; playhead move could flush partial state.
- **Clip length derivation:** Notes might be stored with duration relative to record start; seek could interact badly with **comping** or **take** lanes.

**Files to inspect first:** `Transport/useCases/scheduling/scheduleAudioClips.ts`, MIDI note stores, record/stop handlers, any `playheadPosition` effect on clip geometry.

---

## 3. Timeline: can scroll past the last track into empty space

**Symptom:** Vertical scroll continues below the last track, showing **empty** canvas.

**Preliminary cause:**

- **`setScrollY`** in `Arrangement/stores/timelineViewStore.ts` clamps with  
  `maxY = Math.max(0, totalHeight - 200)` where `totalHeight` **excludes** `master` only (L66–69).
- **`useTimelineGestures`** wheel handler uses a **different** formula:  
  `totalTrackHeight` sums **all** tracks (L57–59) and `maxY = totalTrackHeight - viewHeight` (L59).
- **Mismatch** between gesture path and `setScrollY` (and arbitrary **200px** vs **viewport height**) can allow **over-scroll** or inconsistent limits depending on code path (wheel vs programmatic `setScrollY`, master track height, panel size).

**Files:** `timelineViewStore.ts` (`setScrollY`), `useTimelineGestures.ts` (wheel vertical scroll).

---

## 4. Cut mode (Cut tool) appears to do nothing

**Symptom:** Choosing the **Cut** tool (toolbar) has no visible effect.

**Preliminary cause:**

- `useTimelineInteractions.ts` **does** branch on `tool === 'cut'` and calls `handleCutTool` (L107–109) on **timeline canvas** pointer events.
- If the user enables Cut while focus is on **automation panel**, **mixer**, or **no canvas hit**, **no** `handleCutTool` runs — tool only wired to **timeline** interactions.
- Possible **UX gap:** no affordance that Cut only applies on the arrangement canvas, or `handleCutTool` is a no-op in some states (no clip under cursor, wrong snap).

**Files:** `Arrangement/presentations/hooks/useTimelineInteractions.ts` (`handleCutTool` implementation and call sites).

---

## 5. Deselecting a track should close track-owned bottom panel (e.g. Fermenter)

**Symptom:** Clearing track selection leaves **device bottom panels** (Fermenter, etc.) open even though the track is no longer selected.

**Preliminary cause:**

- Device panels are driven by **`eventBus`** (`panel.showFermenter`, …) via `onPanelShow*` subscribers; **selection** is `trackStore.selectedTrackId` (`selectTrack` in `Arrangement/useCases/toggleTrackState/selectTrack.ts`).
- There is **no** symmetric subscriber that **closes** device panels when `selectedTrackId` becomes `null` (or changes away from the track that opened the panel).
- **Inspector** uses local `selectedDeviceId` in `InspectorPanel.tsx` but bottom **device chrome** is a separate concern.

**Files to inspect:** `AppShell` / panel visibility state, `Workspace/useCases/panels/devicePanels/*`, `selectTrack`, any `trackStore.subscribe` for panel teardown.

---

## 6. Faust Multiband Compressor — AudioWorklet processor name not registered

**Console:**  
`Failed to construct 'AudioWorkletNode': The node name 'b87a4b47…' is not defined in AudioWorkletGlobalScope`  
`[FaustDevice] Failed to create node for faust-multiband-compressor`

**Preliminary cause:**

- Faust nodes use **hash-like** worklet names; registration happens inside **`createFaustNode`** → `mod.generator.createNode(context)` (`Plugin/useCases/faustEngine/compilerEngine.ts`).
- Failure means **`audioWorklet.addModule`** / Faust wasm **did not register** that processor name on **this** `AudioContext` before `new AudioWorkletNode(name, …)`.
- Common triggers: **registration race** (multiple contexts), **failed prior addModule** (swallowed), **context closed**, or **build/mangle** issues — `vite.config.ts` notes `keepNames: true` for Faust mangling (L26–27).

**Files:** `compilerEngine.ts` (`createFaustNode`), Faust module registration for `faust-multiband-compressor`, `faustDeviceFactory.ts`.

---

## 7. `Uncaught ReferenceError: Qu is not defined`

**Symptom:** Appears in **bundled** stack (`bootstrap-*.js`, `inject-*.js`, hashed chunk) — **minified** identifier `Qu`.

**Preliminary cause:**

- Almost certainly **third-party or generated** code (Faust wasm glue, chart lib, or Rolldown chunk) where a global or import was **tree-shaken** or **ordering** broke.
- **Correlate** with **#6** (Faust node creation) and **same session** as Faust errors — likely **same root** (failed module init leaves undefined symbol).
- Needs **source map** or **non-minified** dev build to map `Qu` → source.

---

## 8. MIDI input latency & performance (audit request)

**Goal:** Identify opportunities to **reduce latency** and improve **performance** for live MIDI (keyboard → heard output / scheduled notes).

**Preliminary audit axes (no measurements in this doc):**

| Layer | Questions |
|-------|-----------|
| **AudioContext** | `baseLatency` / `outputLatency`; buffer size where configurable |
| **MIDI ingress** | Web MIDI path: `initWebMidi` / message handlers — main-thread dispatch delay, batching |
| **Scheduling** | `scheduleAudioClips`, `Transport` tick — lookahead, quantum alignment, `currentTime` vs beat |
| **Instrument graph** | Per-device node latency; WASM/worklet queue depth |
| **Main thread** | Store subscriptions on hot paths (`PianoRoll`, etc.); `requestAnimationFrame` chains |
| **CRDT / storage** | Unlikely on hot path for *live* MIDI but verify no synchronous persistence on note-on |

**Concrete code entry points:**  
`AudioEngine/repositories/webMidi/`, `Transport/useCases/scheduling/`, `TrackNode.ts`, instrument-specific nodes (Levain, Yeast, etc.).

---

## 9. Crust: live MIDI does not drive analysis visuals

**Symptom:** Playing a MIDI keyboard does not update **Crust** analysis UI.

**Preliminary cause:**

- Crust UI (`CrustPanel`, `CrustControlZone`) is largely **patch-driven** from `crustStore` / param bridge.
- **Live input metering** may require **telemetry SAB** or **analyzer tap** in the audio graph; Crust might **not** subscribe to MIDI note events for visuals, or **telemetry slot** failed (see **#11**).
- Verify whether Crust expects **audio** signal for “analysis” vs **MIDI** (if analysis is audio-sidechain only, MIDI-only playing would show nothing).

**Files:** `Crust/` processor registration, `wasmDeviceRegistry` / device chain for Crust, any `telemetryAllocator` use for Crust.

---

## 10. Selecting a device should open device inspector (and match “premium” bottom-panel behavior)

**Symptom:** User expects selecting a device to behave like adding a premium instrument: **inspector** focuses that device **and** bottom panel opens.

**Preliminary cause:**

- `InspectorPanel.tsx` keeps **`selectedDeviceId` in local React state** (L30); `TrackInspector` passes **`onSelectDevice={setSelectedDeviceId}`** — selecting a device in the list **only** updates inspector view.
- **Bottom panel** is opened via **`showDevicePanelForType`** from **`TrackDevicesSection`** (e.g. chip/double-click), **not** from the same path as single “select row” if that only sets inspector state.
- **Gap:** single-click device select in inspector list may **not** call `showDevicePanelForType` or `eventBus` panel events — **asymmetric** vs “add instrument” flow.

**Files:** `InspectorPanel.tsx`, `TrackDevicesSection.tsx`, `showDevicePanelForType.ts`.

---

## 11. `[TelemetryAllocator] No free telemetry slots (max 64 active plugins)`

**Preliminary cause:**

- `AudioEngine/engine/telemetryAllocator.ts` — **fixed 64 slots** (`MAX_SLOTS`), **one slot per** `allocateSlot()` call.
- If slots are **not released** on device teardown (`releaseSlot`), or **multiple allocations per device**, exhaustion is expected with large sessions.
- **Warn-only** path returns `null` — downstream may **skip** telemetry updates (explains **#9** if Crust/others rely on SAB telemetry).

**Files:** grep `allocateSlot` / `releaseSlot` in engine and device factories.

---

## 12. Canvas2D: `getImageData` — `willReadFrequently` warning (`ProofChamberPanel.tsx`)

**Console:** Suggests `getContext('2d', { willReadFrequently: true })` when using many readbacks.

**Preliminary cause:**

- `ProofChamberPanel.tsx` (under `modules/ProofChamber/`) uses **`getImageData` in a tight `draw` loop** (e.g. L718–719) for a **scroll/wave** effect.
- Without **`willReadFrequently`**, browsers may optimize for write-heavy use and penalize readbacks.

**Fix direction (when scheduled):** pass options to `canvas.getContext('2d', { willReadFrequently: true })` where profiling confirms benefit.

---

## 13. Grand Boule / `SharedArrayBuffer is not available` (COOP/COEP)

**Console:**  
`SharedArrayBuffer is not available. The server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers.`

**Preliminary cause:**

- `GrandBouleNode.ts` documents **cross-origin isolation** requirement for SAB.
- **`vite.config.ts`** sets **dev server** and **preview** headers (COOP + COEP) (L17–20, L73–77).
- If the app is served by **another host** (embedded iframe, **production** server without same headers, **Tauri** webview with different policy, or **HTTPS** mismatch), **`crossOriginIsolated`** is false → **SAB unavailable**.

**Action:** Verify **actual** response headers on the failing URL; align deployment (nginx, Tauri `dangerousRemoteUrl`, static host) with Vite’s header block.

---

## 14. Duplicate cluster: Faust + `Qu` + inject/bootstrap chunks

The **Faust Multiband Compressor** error, **`Qu` ReferenceError**, and **inject/bootstrap** stacks often appear together — treat as **one investigation thread** until proven separate: worklet registration order, chunk loading, and **cross-origin isolation** for any SAB-based path.

---

## Suggested fix order (product, not mandatory)

1. **Deployment / SAB (#13)** — unblocks Grand Boule and any SAB telemetry depending on isolation.  
2. **Telemetry slot lifecycle (#11)** — prevents silent telemetry loss and may unblock **Crust visuals (#9)**.  
3. **Faust worklet registration (#6, #7)** — restore Faust devices; may clear **`Qu`** if same bundle.  
4. **Timeline scroll clamp consistency (#3)** — quick UX win if formulas aligned.  
5. **Automation scroll sync (#1)** — UX parity with timeline.  
6. **Inspector / device selection (#10)** — align behavior with user mental model.  
7. **Track deselect → close panel (#5)** — selection/panel invariant.  
8. **Cut tool clarity / behavior (#4)** — document or wire automation context.  
9. **Playhead vs MIDI (#2)** — may need repro steps and a failing test.  
10. **Canvas hint (#12)** — performance polish.  
11. **MIDI latency (#8)** — profiling pass + documented audit update.

---

## References (code paths cited above)

- `src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`
- `src/modules/Arrangement/stores/timelineViewStore.ts`
- `src/modules/Arrangement/presentations/hooks/useTimelineGestures.ts`
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts`
- `src/modules/Workspace/presentations/views/InspectorPanel.tsx`
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts`
- `src/modules/AudioEngine/engine/telemetryAllocator.ts`
- `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx`
- `vite.config.ts` (COOP/COEP)
- `src/modules/AudioEngine/engine/GrandBouleNode.ts`
