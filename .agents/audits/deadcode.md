# Deep Dead Code Audit (Knip Results)

Verified analysis of files flagged by `knip` across audit sessions. Maps each flagged file against actual engine usage to distinguish superseded dead code from valuable pending epics.

---

## Executive Summary

| Session                    | Knip count | Action                                                                    |
| -------------------------- | ---------- | ------------------------------------------------------------------------- |
| Baseline                   | 93         | —                                                                         |
| Session 1 (commit bc9c743) | 74         | Deleted obsolete engines, legacy validators, IPC nodes, Inspector layouts |
| Session 2                  | 63         | Deleted 8 more; integrated 3 pending features into UI                     |
| Session 3 (2026-04-07)      | See §0      | Full `pnpm exec knip` refresh; **198** unused files / **132** unused exports (see interpretation) |

**Current state:** Prior manual triage (~63 “flagged files”) reflected **curated** Knip output. Session 3’s **198 unused files** is **raw** Knip — mostly **entry-graph limits** and module barrels, not a deletion backlog. See **§0 Session 3** for metrics and what is actually actionable.

---

## 0. Session 3 — Knip baseline refresh (2026-04-07)

**Command:** `pnpm exec knip` (knip `^6.3.1`, config: `knip.json`). Exit code **1** when any issue is reported.

### Raw metrics

| Category | Count |
| -------- | ----- |
| Unused files | 198 |
| Unused exports | 132 |
| Unused exported types | 8 |
| Duplicate exports | 2 |
| Unused dependencies | 1 |
| Unresolved imports | 1 |
| Configuration hints | 8 |

### How much of this is “legitimate” dead code?

**Very little is safe to treat as bulk-delete dead code.**

1. **Unused files (198)** — **Not** 198 orphan modules. `knip.json` **`entry`** is only `src/routes/**/*.tsx`. Most implementation files are reached via `#/` path aliases and deep imports; Knip does not model the full app graph. Many hits are **`src/modules/*/index.ts` barrels** (aggregate exports by design). **Verdict:** graph / entry limitation + barrels — **not** a green light to delete 198 paths.

2. **Unused exports (132)** — Overlaps heavily with **§3 Incomplete Epics** (adjustment layers, RAVE sub-operations, control room, extensions, node view, Push, plugin bridge, etc.) plus **store helpers**, **bridge exports**, and **command-registered** surfaces Knip does not attribute. A small subset may be trimmable on a **per-symbol** basis when touching that area.

3. **Actionable hygiene** (review in isolation, not mass delete):
   - **Unresolved import (1):** `AutomationSidebarCell.spec.tsx` line 3 — `./AutomationSidebarCell` does not resolve (fix import path or component filename).
   - **Unused dependency (1):** `@typescript-eslint/eslint-plugin` — often loaded only from ESLint config; confirm before removing from `package.json`.
   - **Duplicate exports (2):** `DEFAULT_WEBLLM_MODEL_ID` \| `WEBLLM_MODEL_ID` in `AiRuntime/models/ModelInfo.ts`; `CRUMBS_THEME` \| `SAMPLER_THEME` in `Workspace/.../InstrumentCard.tsx` — naming / duplicate identifier cleanup.
   - **Unused exported types (8)** — e.g. `AutomationLane`, Proof/SampleLibrary model types — may still be part of public model surfaces; verify consumers before removing exports.

4. **Relation to older “63 files”** — Sessions 1–2 reported **manually triaged** “flagged files” after excluding known false positives. Session 3 is a **full** Knip dump **without** that manual filter — **198 is not comparable** to **63** as “more dead code,” only as “stricter / unfiltered unused-file detection.”

### Conclusion (Session 3)

- **No bulk deletion** recommended from this run alone.
- Sections **§1–§4** below remain the authoritative list of **deleted** work, **integrated** UI, **incomplete epics**, and **known false positives**.
- **Next steps:** fix the **unresolved spec import**; optionally reconcile **duplicate exports** and **eslint-plugin** when touching tooling; trim **unused exports** only alongside feature work in the same module.

---

## 1. True Dead Code — All Deleted

### 1.1 Generic SFZ Sample Player _(Session 1)_

- **Files:** `src/modules/AudioEngine/useCases/samplePlayer/` (playback.ts, sfzParser.ts)
- **Reason:** Superseded by the **Levain** WASM sampler (`sampleLoader.ts`, `createLevainNode`), which natively handles SFZ manifests and streams directly into the audio hot path.

### 1.2 Generic Modulation System _(Session 1)_

- **Files:** `src/modules/Plugin/useCases/modulationSystem/` (createModulationRoute, getModulatedValue, etc.)
- **Reason:** Never wired into the playback loop. Architecture shifted to plugin-local modulation inside WASM boundaries (Bacteria). Global TS-level routing was an abandoned experiment.

### 1.3 Device Inspector Bespoke Layouts _(Session 1)_

- **Files:** 15 files in `Inspector/layouts/effects/` (CompressorLayout, EQLayout, etc. — original set)
- **Reason:** Replaced by the schema-driven `deviceLayoutRegistry` pattern, which auto-generates knobs from plugin parameter definitions. New layout files in the same folder ARE used — they self-register via `registerDeviceLayout`.

### 1.4 AI Runtime Legacy Validation _(Session 1)_

- **Files:** `src/modules/AiRuntime/transformers/*`, `useCases/validateLlmOutput.ts`, `useCases/actionSchema.ts`
- **Reason:** LLM bridge was refactored to enforce JSON Schema natively via WebLLM's `response_format`, mapping directly into Automerge CRDTs. Manual TS validators became obsolete.

### 1.5 Legacy Audio IPC & Processors _(Session 1)_

- **Files:** `AudioEngine/models/PluginHostNode.ts`, `AudioEngine/services/kneadProcessor.ts`
- **Reason:** `PluginHostNode` was an orphaned AudioWorklet wrapper; plugin processing now routes natively via `SharedArrayBuffer`. `kneadProcessor` was a WASM AudioWorklet for Knead whose pitch logic moved to native DSP.

### 1.6 Orphaned Type Re-exports _(Session 2)_

- **Files:** `Gluten/useCases/glutenSubscriber.ts`, `Grinder/useCases/grinderSubscriber.ts`
- **Reason:** Single-line `export type { ... }` facades with no consumers. The types are importable directly from the model files.

### 1.7 Orphaned Modulation Types _(Session 2)_

- **Files:** `Plugin/models/ModulationTypes.ts`
- **Reason:** Type definitions (ModulationSource, ModulationTarget, ModulationRoute) for the generic modulation system deleted in 1.2. No consumers remain. Future WASM-local modulation will define its own types inside plugin boundaries.

### 1.8 Bacteria UI Components Without Backing _(Session 2)_

- **Files:** `Bacteria/presentations/components/ModulationCollar.tsx`, `Bacteria/presentations/components/SignalFlowView.tsx`
- **Reason:** `ModulationCollar` renders modulation arcs on knobs but no modulation data feed exists (the routing system was deleted in 1.2). `SignalFlowView` — Fermenter imports its own local `SignalFlowView` from `../components/`, not this Bacteria copy; this file has zero imports.

### 1.9 Redundant Clip Drag Commit _(Session 2)_

- **Files:** `Arrangement/useCases/timelineInteractions/commitClipDrag.ts`
- **Reason:** `useTimelineInteractions.ts` already has a complete, preview-based drag commit implementation (move, trim-start, stretch, multi-clip, undo entries). `commitClipDrag.ts` is a parallel single-pass implementation that was never called. Confirmed zero imports.

### 1.10 Unused DAW Component Primitives _(Session 2)_

- **Files:** `src/components/daw/DawCompactSectionLabel.tsx`, `src/components/daw/DawParamCard.tsx`
- **Reason:** Generic label and Card wrapper components with no imports anywhere in the codebase. Added but never used.

### 1.11 Knead Inspector Controls _(Session 2)_

- **Files:** `Workspace/presentations/views/Inspector/KneadControls.tsx`
- **Reason:** Redundant with the existing `KneadEditor` component already mounted in `ClipView.tsx`. Knead is architecturally a clip editor (bottom panel), not a device inspector panel. `KneadEditor` handles the full experience including blob visualization, retune/humanize sliders, and the "Enable Pitch Editor" prompt.

---

## 2. Newly Integrated _(Session 2)_

These were flagged by knip as unused but have now been mounted in the UI.

### 2.1 SoloModeSelector → TransportBar

- **File:** `Workspace/presentations/views/Transport/SoloModeSelector.tsx`
- **Integration:** Mounted in `TransportBar.tsx` Row 2 right wing, between ToolSelector and UndoRedoButtons.
- **State:** `workspaceState.soloMode` (`'sip' | 'afl' | 'pfl'`) was already persisted. The control is live; full AFL/PFL audio routing is a pending audio engine task.

### 2.2 PadMixer → ToasterPanel

- **File:** `Toaster/presentations/components/PadMixer.tsx`
- **Integration:** Mounted in `ToasterPanel.tsx` right aside as a "Pad mixer" section between Transport and Fill tools. Writes through `updatePad` (boolean muted/soloed) and `setToasterPadParam` (numeric fields).

### 2.3 PresenceOverlay → TimelineSurface

- **File:** `Collaboration/presentations/views/PresenceOverlay.tsx`
- **Integration:** Mounted in `TimelineSurface.tsx` as an absolutely-positioned overlay above the canvas. `beatToX` reads from `timelineViewStore` (scrollX, pixelsPerBeat); `trackIdToY` accumulates heights from `buildTimelineRenderModel()` minus scrollY.
- **State:** WebRTC presence channel, `usePresence` hook, and Automerge sync are all fully wired end-to-end. The overlay was the only missing piece.

---

## 3. Incomplete Epics — DO NOT DELETE

Robust domain logic with real value, missing only their final UI or audio graph bindings.

### 3.1 Adjustment Layers (8 files)

- **Files:** `Arrangement/useCases/adjustmentLayer/` (addAdjustmentRegion, getActiveLayersAtBeat, getLayerCount, removeAdjustmentLayer, removeAdjustmentRegion, setLayerMix, setLayerParameter, toggleAdjustmentLayer)
- **Status:** `createAdjustmentLayer` is registered and executed in `batchFeatureHandlers.ts`. State and creation are live. The Arrangement timeline doesn't yet render adjustment layer regions.

### 3.2 Node-Based Plugin View (8 files)

- **Files:** `Plugin/useCases/nodeView/` (addNode, buildFromDeviceChain, connectNodes, disconnectNodes, moveNode, removeNode, setViewport, toggleBypass)
- **Status:** `toggleNodeView` is registered in the command palette. The React canvas UI for dragging and connecting nodes has not been built.

### 3.3 Ableton Push Integration (8 files)

- **Files:** `Plugin/useCases/pushIntegration/` (handlePadPress, handlePadRelease, mapEncoder, setEncoderValue, setPadColor, setPadMode, setScale, updateDisplay)
- **Status:** Base connect/disconnect commands are registered in `finalFeatureHandlers.ts`. Pad and encoder logic is orphaned from the event dispatch loop.

### 3.4 Extensions API (15 files)

- **Files:** `Extension/services/scripting.ts`, `Extension/stores/extension.ts`, `Extension/useCases/extension/` (13 use cases)
- **Status:** Full domain model for installing, running, and managing third-party editor scripts. No UI entry point yet.

### 3.5 Toaster MPC Advanced Features (4 files)

- **Files:** `Toaster/useCases/noteRepeat.ts`, `sixteenLevels.ts`, `soundLocks.ts`, `setMorphPosition.ts`
- **Status:** PadMixer is now integrated (§2.2). These four use cases (MPC-style performance features) are still pending UI and sequencer wiring. The morph state model exists in `toasterStore`; interpolation DSP is missing.

### 3.6 CRDT Collaboration Merge UI (3 files)

- **Files:** `CrdtDocument/presentations/views/MergeResultDialog.tsx`, `CrdtDocument/useCases/crdtMerge.ts`, `CrdtDocument/useCases/sdawFileFormat.ts`
- **Status:** Full WebRTC + Automerge peer sync is live (confirmed). These files handle the `.sdaw` binary format and a merge conflict dialog. The dialog is not triggered anywhere; the format encoder/decoder is not called from any save/load flow yet.

### 3.7 Native Project File I/O

- **Files:** `Project/repositories/nativeProjectFiles.ts`
- **Status:** Tauri-based filesystem operations for `.sourdaw` project files. Not called from any save/load handler yet.

### 3.8 Native Plugin Bridge — Full State Persistence (5 files)

- **Files:** `Plugin/repositories/pluginBridge/` (getPluginParameters, getPluginState, isPluginGuiSupported, setPluginParameter, setPluginState)
- **Status:** The Tauri Rust bridge actively processes audio via SharedArrayBuffer. These IPC methods for getting/setting full plugin state (VST3/AU preset recall) are not wired to the preset system. `isPluginGuiSupported` and the GUI launch button in `TrackDevicesSection` are unconnected.

---

## 4. False Positives — Actively Used

Knip flags these because it cannot trace their consumption (re-exports, dynamic registry, external store subscriptions). Verified as live.

| File                                                               | Evidence of use                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Levain/repositories/levainPresets.ts`                             | Imported in 11 files including `LevainPanel.tsx`, preset handlers                   |
| `Plugin/ProofChamber/models/ProofChamberState.ts`                  | Used by `chamberStore.ts`                                                           |
| `Plugin/ProofChamber/presentations/views/ProofChamber.tsx`         | Registered in device layout registry and processor                                  |
| `Plugin/ProofChamber/presentations/views/SpectrogramView.tsx`      | Used by `ProofChamber.tsx`                                                          |
| `Plugin/ProofChamber/stores/chamberStore.ts`                       | Used by `ProofChamber.tsx` and device processor                                     |
| `ProofChamber/repositories/proofChamberPresets.ts`                 | Used by `InstrumentsTab.tsx` and preset handlers                                    |
| `Toaster/models/GrooveTemplates.ts`                                | Used by `GrooveModule.ts` in the Yeast processor                                    |
| `Workspace/presentations/components/Sidebar/SectionHeader.tsx`     | Re-exported via `deviceLayoutRegistry.tsx`; used by 8+ layout components            |
| `Workspace/useCases/automationSubLanes.ts`                         | State mutations read by `hitTestAutomationSubLane.ts`                               |
| `Arrangement/useCases/clipGainEnvelope/getAllClipGainEnvelopes.ts` | `getGainAtBeat` (same folder) is imported and called at `scheduleAudioClips.ts:113` |
| `Arrangement/useCases/clipGainEnvelope/moveGainEnvelopePoint.ts`   | Referenced by `ClipGainEnvelopeSection.tsx`                                         |

---

## 5. Stale Items from Previous Audit

These were documented as "KEEP" in the original audit but were subsequently removed by commit `bc9c743`.

- **DAWproject export** (`Project/useCases/dawProject/exportDawProject.ts`, `parseDawProject.ts`) — directory is now empty. The `exportDawProject` command in `finalFeatureHandlers.ts` still fires a `notifyUser` stub; the backing implementation is gone.
- **Undo tree navigation** (`Command/useCases/undoTree/navigateToNode.ts`, `queries.ts`) — deleted. The tree-writing side (`recordToTree.ts`, `branchOperations.ts`, `toggleUndoTree.ts`) remains and is active.

---

## Conclusion

After two audit sessions, knip had been reduced from **93 → 63** **manually triaged** flagged files.

- **30 files deleted** across the two sessions — all confirmed as superseded, redundant, or entirely without consumers.
- **3 features integrated** into the UI with no regressions.
- **63 remaining files** (Session 2 framing) are either pending epics (real domain value, missing one integration layer) or false positives (actively used but unreachable by static analysis). None should be deleted **on that basis alone**.

**Session 3 (§0):** A fresh `pnpm exec knip` run reports **198** unused files and **132** unused exports — mostly **entry-graph limits**, barrels, and epic-related symbols. Treat as **baseline metrics** and **hygiene hints**, not a deletion quota.
