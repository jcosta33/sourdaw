# Deep Dead Code Audit (Knip Results)

This document contains a deep, verified analysis of the items flagged as dead code or unused exports by `knip` (as seen in `knip-results.txt`). Unlike a surface-level scan, this audit maps the flagged files against actual engine usages to determine whether the code was superseded by newer architecture or remains a valuable, incomplete feature.

## Executive Summary & Resolution Update

**Resolution Update:** The cleanup of "True Dead Code" has been executed. The total number of unused files flagged by `knip` has dropped from 93 to 74. 
- Obsolete engines (SFZ parser, Modulation System), unused Inspector UI bloat, legacy AI Runtime validators, the abandoned Tauri `PluginHostNode`, and the abandoned `kneadProcessor` have all been safely **deleted**.
- The remaining 74 flagged files represent valuable **Pending Epics** (like Elastic Audio, Extensions API, Ableton Push integration, and Node-Based plugin routing) or **False Positives** that are actively used. They should **NOT** be deleted.

While `knip` successfully identified disconnected code, a deeper architectural review reveals a mix of **superseded dead code** (which has now been deleted) and **orphaned domain foundations** (which represent pending epics). 

Several major features (like the `sfzParser` and generic `modulationSystem`) were actually replaced by superior, purpose-built engines (`Levain` and `Bacteria`), making their older generic implementations true dead code. Conversely, systems like Elastic Audio and the Git-style Undo Tree remain valuable domain stubs that simply lack UI bindings.

---

## 1. True Dead Code (Superseded & Deleted)

These files and systems were abandoned in favor of better, more specialized architectures built elsewhere in the DAW. They have been removed from the codebase.

### 1.1 Generic SFZ Sample Player
- **Flagged Files:** `src/modules/AudioEngine/useCases/samplePlayer/*` (playback.ts, sfzParser.ts)
- **Analysis:** This was an early attempt to build a generic SFZ sample parser for the audio engine. However, it has been completely superseded by the **Levain** module (`src/modules/Levain/repositories/sampleLoader.ts` and the `createLevainNode` Rust/WASM sampler), which is a purpose-built, high-performance sampler that natively handles SFZ manifests and streams them directly into the audio hot path.
- **Verdict:** **DELETED.** Obsolete and inferior to the active Levain implementation.

### 1.2 Generic Modulation System
- **Flagged Files:** `src/modules/Plugin/useCases/modulationSystem/*` (createModulationRoute, getModulatedValue, etc.)
- **Analysis:** This generic modulation system attempted to route LFOs to AudioParams globally. This system "had no AudioParam.setValueAtTime() bindings" and was never wired into the playback loop. Instead, the DAW adopted a plugin-local modulation approach, visible in the **Bacteria** multi-effect.
- **Verdict:** **DELETED.** The global generic modulation system was an abandoned experiment. Future modulation routing is handled natively inside WASM plugin boundaries.

### 1.3 Device Inspector Bespoke Layouts
- **Flagged Files:** 15 files in `src/modules/Workspace/presentations/views/Inspector/layouts/effects/*` (`CompressorLayout.tsx`, `EQLayout.tsx`, etc.)
- **Analysis:** These were manual React UI layouts for specific built-in effects. Sourdaw has moved towards generic, schema-driven parameter grids that auto-generate knobs based on the plugin's parameter definitions.
- **Verdict:** **DELETED.** Unused UI stubs.

### 1.4 AI Runtime Legacy Validation
- **Flagged Files:** `src/modules/AiRuntime/transformers/*`, `useCases/validateLlmOutput.ts`, `useCases/actionSchema.ts`
- **Analysis:** The LLM bridge was refactored to enforce a JSON Schema natively via WebLLM's `response_format` and to map directly into Automerge CRDTs. This rendered these manual intermediate TS validators and transformers obsolete bloat.
- **Verdict:** **DELETED.**

### 1.5 Legacy Audio IPC & Processors
- **Flagged Files:** `src/modules/AudioEngine/models/PluginHostNode.ts`, `src/modules/AudioEngine/services/kneadProcessor.ts`
- **Analysis:** `PluginHostNode` was an orphaned AudioWorklet wrapper for the Tauri plugin host. The DAW now routes plugin processing natively or via `SharedArrayBuffer`s. `kneadProcessor.ts` was an unused WASM AudioWorklet processor for the Knead plugin whose pitch logic is handled natively now.
- **Verdict:** **DELETED.**

### 1.6 Shadcn Component Exports
- **Flagged Exports:** `CardHeader`, `CardTitle`, etc. in `src/components/ui/card.tsx`
- **Verdict:** **IGNORED.** Standard unused exports from UI library templates. Preserved for future use.

---

## 2. Incomplete Epics (Orphaned but Valuable - DO NOT DELETE)

These features have robust domain logic but are missing their final bindings to the React UI or the Audio Graph. They should **not** be deleted, but rather tracked as pending roadmap epics.

### 2.1 Elastic Audio & Audio Warping
- **Flagged Files:** `src/modules/AudioEngine/useCases/elasticAudio/*`, plus exports like `addWarpMarker`.
- **Analysis:** This is a comprehensive transient detection and time-stretching engine. It is entirely disconnected from the active `TrackNode` and offline renderer. It has not been superseded; it simply hasn't been wired into the WebAudio/WASM execution paths yet.
- **Verdict:** **KEEP.** Highly valuable domain logic awaiting integration into the audio graph.

### 2.2 Node-Based Plugin View
- **Flagged Files:** `src/modules/Plugin/useCases/nodeView/*` (addNode, connectNodes, moveNode)
- **Analysis:** A node-based UI alternative to the standard mixer channel strip (similar to Bitwig's Grid or Max/MSP). The action `toggleNodeView` is registered in the command palette, but the React canvas UI to drag and connect nodes has not been implemented.
- **Verdict:** **KEEP.** Valuable alternative routing architecture.

### 2.3 Ableton Push Integration
- **Flagged Files:** `src/modules/Plugin/useCases/pushIntegration/*` (handlePadPress, setEncoderValue, updateDisplay)
- **Analysis:** Native hardware integration for Ableton Push. The base connect/disconnect commands are registered in `finalFeatureHandlers.ts`, but the actual pad/encoder logic is orphaned.
- **Verdict:** **KEEP.** Hardware controller mapping logic.

### 2.4 Extensions API
- **Flagged Files:** `src/modules/Extension/*`
- **Analysis:** A massive suite of use cases for installing, running, and managing third-party editor scripts.
- **Verdict:** **KEEP.** Foundation for third-party scripts.

### 2.5 Toaster MPC Features
- **Flagged Files:** `src/modules/Toaster/useCases/*`
- **Analysis:** Advanced drum machine logic (16 Levels, Note Repeat, Sound Locks).
- **Verdict:** **KEEP.** Pending UI wiring.

### 2.6 DAWproject Export
- **Flagged Files:** `src/modules/Project/useCases/dawProject/*` (exportDawProject, parseDawProject)
- **Analysis:** Support for the open `DAWproject` file format. A UI command exists (`exportDawProject`) but it currently just fires a `notifyUser` stub instead of executing the actual `exportDawProject` function.
- **Verdict:** **KEEP.** Essential for Bitwig/Studio One interoperability. The command just needs to be wired up.

---

## 3. Partially Wired Features & False Positives

These are features that are actually actively used in the codebase, but were flagged by `knip` due to partial implementation or being exported but only used dynamically.

### 3.1 Clip Gain Envelopes
- **Flagged Files:** `getGainAtBeat.ts`, `getAllClipGainEnvelopes.ts`
- **Analysis:** `getGainAtBeat` *is* explicitly imported and used in the core audio scheduler (`src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`). Knip flagged it either due to a dynamic import quirk or because it is a false positive. Clip gain envelopes are actively rendered in the UI (`ClipGainEnvelopeSection.tsx`).
- **Verdict:** **FALSE POSITIVE / KEEP.** This code is alive and running in the audio engine.

### 3.2 Non-Linear Undo Tree Navigation
- **Flagged Files:** `navigateToNode.ts`, `queries.ts`
- **Analysis:** Sourdaw uses a linear undo history natively, but has the domain logic for a non-linear Git-style Undo Tree. Branches are actively recorded (`undoStore.ts` calls `recordToTree.ts`), but the UI views to navigate or query the tree are unbuilt, leaving the getters orphaned.
- **Verdict:** **KEEP.** The engine actively records to the tree; it just needs a UI.

### 3.3 Adjustment Layers
- **Flagged Files:** `src/modules/Arrangement/useCases/adjustmentLayer/*`
- **Analysis:** The action `createAdjustmentLayer` is registered and executed in `batchFeatureHandlers.ts`. However, the functions to manipulate the regions on the timeline (e.g. `addAdjustmentRegion`) are orphaned because the Arrangement UI doesn't render adjustment layer regions yet.
- **Verdict:** **KEEP.** The state and creation logic is alive; the view logic is pending.

### 3.4 Native Plugin Bridge IPC Getters
- **Flagged Files:** `getPluginParameters.ts`, `setPluginState.ts`
- **Analysis:** The Tauri Rust bridge actively processes audio (`NativePluginBridgeNode`), passing parameter changes directly through a SharedArrayBuffer. The explicit Tauri IPC methods to get/set full plugin state (`getPluginParameters.ts`) are orphaned, likely because VST3/AU preset state recall isn't fully implemented yet.
- **Verdict:** **KEEP.** Necessary for future plugin state persistence.

---

## Conclusion

A deep inspection confirms that `knip` captured three distinct phenomena:
1. **Obsolete generic engines** (SFZ parser, Modulation System, legacy AI Validators, old IPC nodes) that were replaced by specialized implementations. **These have been deleted.**
2. **UI bloat** (Inspector layouts) that were replaced by dynamic generation. **These have been deleted.**
3. **Pending Epics** (Elastic Audio, Node View, DAWproject, Push, Extensions) that are fully modeled but lack their final execution bindings. **These must be preserved.**
