# Module `index.ts` Boundary Audit

## Update 2026-04-09

This audit body remains as the historical baseline captured when the migration began. The current worktree state has now completed that migration:

- `pnpm deps:validate` passes with `✔ no dependency violations found (1599 modules, 4427 dependencies cruised)`.
- Current validated checkpoint after the latest segregation work is `✔ no dependency violations found (1599 modules, 4423 dependencies cruised)`.
- `pnpm typecheck` passes with `> tsgo --noEmit`.
- Cross-module callers now resolve through module-root contracts, while intra-module callers remain on direct internal paths.
- A follow-up cleanup also removed the obvious non-root local barrels and proxy files that remained after the migration (`timelineViewActions.ts`, `trackViewActions.ts`, `TimelineContextMenus.tsx`, `demoFactories.ts`).
- A strict scan now finds no remaining non-root files under `src/modules` that consist only of imports/exports/comments once root `index.ts` contracts and generated `wasm/*.js` bindings are excluded.
- The recent Workspace cleanup corrected another case of fake compliance: consumer presentation files now duplicate the tiny view/store slices they need locally instead of importing remote state/model aliases. That latest batch covered `RoutingGraph.tsx`, `CCLane.tsx`, `ChordTrackLane.tsx`, `ScratchPadView.tsx`, `PianoRoll.tsx`, `PianoRollToolbar.tsx`, and `usePianoRollInteractions.ts`.
- Follow-up slices continued the same correction in Workspace hooks and inspector/automation views: `useTempoEditorState.ts`, `useTracks.ts`, `PitchBendLane.tsx`, `TakesSection.tsx`, `DeviceParameterControl.tsx`, both `TrackAutomationSection.tsx` files, `TrackDevicesSection.tsx`, `AutomationView.tsx`, `MacrosPanel.tsx`, `automationLaneConstants.ts`, and `AutomationContextMenu.tsx` now own local consumer-side shapes instead of importing remote state/model/type aliases.
- The latest follow-up also cleaned the remaining `Workspace` presentation root type imports (`AutomationLaneRow.tsx`, `AutomationBottomPanel.tsx`, `PromptBar.tsx`, `usePromptExecution.ts`), removed same-module root/event indirection inside `Workspace` use cases, and tightened several `AiRuntime` presentation files so they no longer import their own module internals through `#/modules/AiRuntime/...` paths or depend on `AiGeneration`'s task-result type alias directly.
- The next validated follow-up replaced the remaining private `AiRuntime` dependency on `Command`'s action union with a duplicated module-local `RuntimeAction` model. Prompt parsing, preset builders, validation, and chat execution now depend on that private model instead of `#/modules/Command`, and the unused named `IntentResult` root export was removed.
- `Workspace/useCases/workspaceHandlers.ts` and `scratchPadHandlers.ts` now own their local action subsets and handler shapes instead of importing `ActionHandler` / `AppAction` from `Command`, which closes the same seam on the `Workspace` side without creating any new shared type surface.
- Another same-module cleanup afterward removed the last focused `AiRuntime` / `Workspace` presentation leaks through absolute private paths: `ChatPanel.tsx`, `useVoiceRecording.ts`, `InspectorPanel.tsx`, `usePromptExecution.ts`, `useAppKeyboardShortcuts.ts`, and `Sidebar/EffectsTab.tsx` now use direct relative internal imports.
- The next follow-up shrank two more module-root contracts instead of inventing public patch DTOs: `Proof/index.ts` now exports only the audio-engine hooks actually used cross-module, and `Levain/index.ts` now exports only its panel, store, engine-ready flag, sample autoload hook, and registration hooks. Their patch-mutating bridge helpers remain internal to their own modules.
- `Fermenter` needed a different treatment because `MIDI` really does call into it cross-module. Instead of exporting the patch-typed bridge helper, the module root now exposes a narrow `setFermenterMappedParam` use case that takes `{ deviceId, paramId, value }` and validates `paramId` against the public `FERMENTER_PARAMS` list before delegating internally.
- Follow-up cleanup kept removing borrowed `Command` handler types from other module-local registries as well: `Project`'s version-control and song-structure handler maps, `MIDI/useCases/patternInstanceHandlers.ts`, and `AudioEngine/useCases/finalFeatureHandlers.ts` now own local action subsets and local handler shapes instead of importing `ActionHandler<any>`. Same-module absolute imports in those files were also converted to direct relative internal paths.
- The same handler-registry cleanup kept going afterward: `AudioAnalysis/useCases/analysisHandlers.ts`, `AiGeneration/useCases/generationHandlers.ts`, `AiGeneration/useCases/aiMidiHandlers.ts`, `MIDI/useCases/chordTrackHandlers.ts`, `Plugin/useCases/pluginHostHandlers.ts`, `Workspace/useCases/scratchPadHandlers.ts`, `Arrangement/useCases/deviceHandlers.ts`, and `Arrangement/useCases/stretchHandlers.ts` now own local action subsets and exact local handler maps instead of borrowing `Command`'s handler types. Their same-module absolute internal imports were also replaced with direct relative imports.
- One typecheck regression in that cleanup was real and useful: several local handler description types still used `inverseAction?: unknown`, which stopped being assignable to `Command`'s registry expectations once the exact local map types were introduced. Those descriptions were tightened to the actual local fields in use instead of importing `Command` types back across the boundary.
- The follow-up after that finished the rest of the Arrangement handler family in the same pattern: `trackHandlers.ts`, `clipHandlers.ts`, `restoreHandlers.ts`, `presetHandlers.ts`, `batchFeatureHandlers.ts`, and `newFeatureHandlers.ts` now use local action subsets plus exact local handler maps, and their same-module Arrangement imports are all direct relative imports.
- One more typecheck regression there was also legitimate: the first mapped handler types for `trackHandlers.ts` and `clipHandlers.ts` accidentally required `restoreTrack` / `restoreClip` entries in the wrong files. That was fixed by separating handled action unions from inverse-action payload types while keeping the undo descriptions structurally compatible with the `Command` contract.
- Current validated checkpoint after those follow-ups is still green: `pnpm deps:validate` reports `✔ no dependency violations found (1601 modules, 4427 dependencies cruised)` and `pnpm typecheck` passes.
- Remaining cleanup is no longer about cross-module index violations; it is now primarily same-module absolute internal imports and a small amount of internal handler-registry cleanup. A fresh scan at this checkpoint found **527** remaining same-module `#/modules/<SameModule>/...` imports across the repo.
- The largest remaining same-module absolute-import buckets at this checkpoint are:
  - `Arrangement`: **194**
  - `Transport`: **96**
  - `AudioEngine`: **64**
  - `MIDI`: **47**
  - `Automation`: **34**
  - `Plugin`: **26**
  - `SoundLibrary`: **23**
- The immediate next seam is still `Arrangement/useCases`, but it is much smaller now. Only **10** same-module absolute internal imports remain there, concentrated in:
  - `useCases/clipboard/pasteClip.ts`
  - `useCases/clipboard/cutSelectedClip.ts`
  - `useCases/clipEditing/splitClipWithUndo.ts`
  - `useCases/recording.ts` (3 imports)
  - `useCases/importAudioFile.ts`
  - `useCases/audioAnalysis.ts`
  - `useCases/duplicateTrack.ts`
  - `useCases/setTrackGainPan.ts`
- The external-module `ActionHandler` borrowing seam is effectively closed. A focused scan now finds **0** remaining non-`Command` files importing `ActionHandler` / `AppAction` from `#/modules/Command` for local registry typing.
- The remaining handler-registry style debt is now isolated inside `Command` itself. A focused scan found **8** `Record<string, ActionHandler<any>>` registries still on the old pattern:
  - `Command/useCases/executeAppAction.ts` (`trackAlternativeHandlers`, `templateHandlers`, `vcaHandlers`, `midiRoutingHandlers`, `dsoSnapshotHandlers`, `handlerRegistry`)
  - `Command/useCases/macroHandlers.ts`
  - `Command/useCases/undoTreeHandlers.ts`
- Warnings for the next agent from mistakes already made and corrected in this session:
  - Do **not** recreate shared models under `useCases/` to bypass the “models are private” rule. That mistake already happened once in `Project` (`projectPersistenceData.ts`) and was removed in the same session. Broad “contract dump” files in `useCases/` are still fake compliance.
  - Do **not** replace private-model imports with broad exported type surfaces from `useCases/` or module roots. The correct fix is segregated local types per boundary, duplicated where needed, or a smaller public surface.
  - Do **not** treat a passing dependency rule as proof that the refactor is correct. This task already had one failed codemod attempt earlier in the work that produced duplicate same-source imports and had to be reset. Manual diff inspection and typecheck remain mandatory.
  - When tightening handler registries, do **not** widen back to `Record<string, ActionHandler<any>>` just to make the compiler happy. Keep exact local handler maps or small local helpers, and fix the real type mismatch.
  - When converting exact handler maps, keep handled actions separate from inverse-only undo payload actions. The first `trackHandlers.ts` / `clipHandlers.ts` rewrite failed because `restoreTrack` / `restoreClip` were accidentally made required handler keys in the wrong files.
  - When local description types participate in the `Command` registry flow, do **not** use `inverseAction?: unknown`. That already caused a real regression. Keep the local type structurally compatible with the actual inverse action shape you emit.
- Suggested next pickup order for the next agent:
  - Finish the remaining 10 `Arrangement/useCases` same-module absolute imports first, because that seam is already hot and localized.
  - Then re-scan and move module-by-module through the next biggest same-module buckets (`Transport`, `AudioEngine`, `MIDI`).
  - Leave the internal `Command` registry-style cleanup until after the import-path cleanup unless the goal shifts from import hygiene to exact local registry typing.
- Follow-up semantic cleanup also started replacing model leaks with module-owned contract types: `AiGeneration` now owns its generated MIDI note shape locally, and `MIDI` now owns its public `ChordType` contract in `useCases/chordStamps.ts` instead of re-exporting it from `models/ChordTypes.ts`.
- Additional semantic cleanup completed afterward without regressing validation: `AiRuntime/useCases/voiceDictation.ts` now owns a public `DictationResult` DTO, and `AudioEngine/useCases/audioEngineQueries.ts` now owns the public synth/drum/sidechain types it exports instead of aliasing `AudioEngine/models/*`.
- `AudioEngine/index.ts` no longer exports `BusStrip`; there were no external consumers, so that Web Audio node shape did not need to be part of the public contract.
- Non-Command modules no longer import `#/modules/Command/useCases/commandQueries` or `#/modules/Command/models/AppAction` directly; they now go through `#/modules/Command`.
- `Command` no longer exposes `models/*` as its live contract source. `src/modules/Command/useCases/commandQueries.ts` now owns the public `AppAction`, undo, and handler types/functions, and the remaining live internal consumers were migrated to that use-case-owned contract.
- Follow-up cleanup after that reduced several more public contract leaks while keeping `pnpm deps:validate` and `pnpm typecheck` green:
  - `AiRuntime/stores/aiActionHistoryStore.ts` now stores local summary entries instead of full `Command` actions.
  - `Routing/useCases/sidechain.ts` now owns `SidechainRoute`, and `AudioEngine` no longer exports that routing DTO.
  - `CrdtDocument/useCases/crdtDocumentTypes.ts` now owns its public document-id/bundle/merge types instead of re-exporting `models/CrdtDocumentTypes.ts`.
  - `Workspace/useCases/workspaceQueries.ts` now owns the public Workspace preference/tool/state contract instead of re-exporting `Workspace/models/*`.
  - `Yeast/useCases/yeastSchedulingBridge.ts` now owns the public `MidiEvent` / `TransportInfo` contract used by Transport, and `Yeast/index.ts` no longer exports those types from `models/MidiEvent.ts`.
  - `AudioEngine/useCases/webMidiInput.ts` now owns `MidiInputInfo`, and `AudioEngine/useCases/nativeAiBridge.ts` now owns `DenoiseResult`.
  - `Plugin/useCases/pluginScan/queries.ts` now owns `ScannedPlugin`, and its current consumers go through `#/modules/Plugin`.
  - `AiRuntime/useCases/aiRuntimeQueries.ts` now owns the public `MixAnalysis` / `MixIssue` contract instead of re-exporting `AiRuntime/models/MixAnalysis.ts`.
  - `Command/useCases/macro/recording.ts` now owns the public `Macro` type instead of re-exporting `Command/models/Macro.ts`.
  - `rg -n "models/AppAction|models/UndoEntry|models/ActionHandler" src/modules/Command src/modules` now returns no matches.
  - `Collaboration/useCases/collaborationQueries.ts` now owns the public `CollaborationState` DTO instead of re-exporting `Collaboration/models/CollaborationTypes.ts`.
  - `Fermenter/index.ts` no longer exposes `FermenterPatch` or `DEFAULT_PATCH`; the root contract was shrunk to the cross-module metadata that is actually used.
  - `Arrangement/useCases/scratchPad/scratchPadCrud.ts` now owns the public `ScratchPadSection` DTO, and `Arrangement/stores/scratchPadStore.ts` now consumes that public type.
  - `AiRuntime/useCases/aiRuntimeQueries.ts` no longer re-exports `PATTERN_TEMPLATES` / `filterTemplates` directly from `models/midiPatternLibrary.ts`; it exposes wrapped public values instead.
  - Dead internal type re-exports were removed from `Bacteria/useCases/bacteriaParamBridge.ts` and `Toaster/useCases/loadToasterKit.ts`.
  - `rg -n "export type \\{ .*from '../models|export type \\{ .*from '../../models|export \\{ .*from '../models|export \\{ .*from '../../models" src/modules/*/useCases src/modules/*/presentations/views src/modules/*/stores` now returns no matches.
  - `Workspace/useCases/setEditingTool.ts`, `setWorkspaceMode.ts`, and `workspaceState.ts` no longer lean on `Workspace/models/*` in their public signatures.
  - `Transport/useCases/transportQueries.ts` now owns the public transport state/change/default-state contract instead of forwarding it from `Transport/models/*`.
  - `Toaster/useCases/toasterQueries.ts` now owns the public `DEFAULT_PAD_NAMES` constant.
  - `Transport/stores/tempoMapStore.ts`, `Transport/stores/timeSignatureMapStore.ts`, and `Arrangement/stores/markerStore.ts` now own their exported public DTO/store-state shapes instead of importing them from private model files.
  - `Project/models/ProjectData.ts` no longer imports any cross-module store or model contracts. The serialized project file shape is now fully Project-owned, including transport, automation, MIDI, marker, take-lane, sidechain-route, audio-buffer, and full track-graph DTOs.
  - `Workspace/useCases/workspaceQueries.ts` now also owns `defaultWorkspaceState`, and the root-exported `preferencesStore`, `workspaceStore`, `setTrackHeight`, and `togglePanel/panelToggles` files now consume `workspaceQueries.ts` instead of `Workspace/models/*`.
  - `Transport/stores/transportStore.ts` now consumes `defaultTransportState` and `TransportState` from `useCases/transportQueries.ts` instead of `models/TransportState.ts`.
  - `Automation/stores/automationStore.ts` and `MIDI/stores/midiStore.ts` now own their exported public DTO/store-state shapes directly instead of importing them from `models/*`.
  - `AudioEngine/stores/audioGraphStore.ts` now owns `AudioRoute`, `AudioGraphState`, and `defaultAudioGraphState` directly instead of republishing `models/AudioGraph.ts`.
  - `CrdtDocument/stores/branchStore.ts` now owns `BranchRecord`, `BranchStoreState`, and `MAIN_BRANCH_ID` directly instead of depending on `models/BranchTypes.ts`.
  - `Scoring/stores/scoringStore.ts` now owns `DisplayMode`, `TunerState`, and `DEFAULT_TUNER_STATE` directly instead of depending on `models/ScoringState.ts`.
  - `Project/stores/arrangementStore.ts` now owns the public `ArrangementSnapshot` graph directly instead of depending on `models/ProjectData.ts`, and `Project/useCases/arrangement.ts` now consumes that store-owned snapshot contract.
  - `Project/models/ProjectData.ts` no longer carries its own duplicate arrangement snapshot type; it now uses the public arrangement-store snapshot contract for persisted `arrangements`.
  - `Bacteria`, `Gluten`, `Grinder`, `Proof`, and `Scoring` no longer export their internal device stores at the module root; those stores had no cross-module consumers, so the root contracts were shrunk to the actually used meter/update or panel surfaces.
  - `Plugin/stores/pluginScanStore.ts` now owns the public `ScannedPlugin` DTO directly, and `Plugin/useCases/pluginScan/queries.ts` now consumes that store-owned contract instead of depending on `repositories/pluginBridge/types.ts`.
  - `Knead/stores/kneadStore.ts` now owns `NoteBlob`, `KneadTrackState`, and `KneadStoreState` directly, and `Knead/useCases/dspAnalysis.ts` now consumes that store-owned `NoteBlob` contract instead of `models/KneadBlob.ts`.
  - `SampleLibrary/stores/libraryStore.ts` now owns the public `LibraryRoot`, `SampleRecord`, and `FolderNode` DTOs behind the root-exported `libraryStore` / `LibraryState` contract instead of importing them from `models/LibraryTypes.ts`.
  - `Arrangement/stores/trackStore.ts` now owns the public track graph DTO (`Track`, `Clip`, `Device`, `Send`, related enums), and the root-exported Arrangement track accessors/mutators now consume that store-owned contract instead of `models/Track.ts`.
  - A follow-up Arrangement pass removed the remaining public `models/Track.ts` leaks from root-exported files such as `recording.ts`, `updateClip.ts`, `setTrackGainPan.ts`, `addDevice.ts`, `addExternalDevice.ts`, `setDeviceParameter.ts`, `presetLoading.ts`, `addClip.ts`, `resolveComping.ts`, `stripSilence.ts`, `createAlternativeClips.ts`, `splitClip.ts`, and `setClipFollowAction.ts`. Remaining `models/Track` imports in Arrangement are now internal helpers/tests plus the legitimate `createTrack` implementation dependency.
  - `Collaboration/useCases/collaborationQueries.ts` now owns the public `CollaborationPeer`, `PresenceView`, and `PresenceData` DTOs. The root `Collaboration` contract exports them, and `sessionManagement.ts` / `usePresence.ts` now consume that use-case-owned contract instead of `models/CollaborationTypes.ts`.
  - CrdtDocument's root-facing document lifecycle APIs now consistently consume `useCases/crdtDocumentTypes.ts` instead of the old private model file. The remaining `models/CrdtDocumentTypes` / `models/BranchTypes` imports are limited to internal helpers (`sdawFileFormat.ts`, `crdtBranching.ts`, `crdtMerge.ts`).
  - AiRuntime's root-facing prompt/context contract no longer depends on private model files for live signatures: `getProjectContext.ts` now owns the public `ProjectContext*` DTOs, `aiRuntimeQueries.ts` now owns `IntentResult`, `parsePromptToActions.ts` consumes those use-case-owned contracts, and the module root exports `ProjectContext` from `getProjectContext.ts`.
  - A mistaken `Project/useCases/projectPersistence/projectPersistenceData.ts` contract dump was created and removed in the same session after re-reading the architecture docs. The correct boundary fix was to shrink the root `Project` surface instead of cloning `ProjectData` into `useCases/`.
- `Project/index.ts` no longer exports the internal persistence helpers `clearUndoHistory`, `resetModuleStoresToDefault`, or `hydrateModuleStoresFromProjectData`; only `verifyAudioBufferReferences` remains public there.
- `Project/useCases/projectTemplates/templateDefinitions.ts` now owns the narrow public `ProjectTemplate` contract it returns instead of exposing `models/ProjectTemplateTypes.ts` through a root-exported use case.
- `AiRuntime/useCases/aiRuntimeQueries.ts` no longer exports preset-builder model types or `buildAction` callbacks through the module root. The public preset API now returns summary DTOs, while `resolvePresetActions` is the explicit root use case for turning a preset id plus local Workspace context into `AppAction[]`.
- `Workspace/presentations/hooks/usePromptExecution.ts` now keeps its preset-context shape local to Workspace instead of importing `PresetContext` from `#/modules/AiRuntime`.
- `CrdtDocument/presentations/views/BranchManagerDialog.tsx` and `useCases/crdtBranching.ts` now consume `BranchRecord` / `BranchStoreState` / `MAIN_BRANCH_ID` from `stores/branchStore.ts`, so `models/BranchTypes.ts` is no longer referenced by root-exported CrdtDocument surfaces.
- `Scoring/presentations/views/ScoringPanel.tsx` now consumes `DisplayMode` from `stores/scoringStore.ts` instead of the private `models/ScoringState.ts`, so the root-exported Scoring view follows the store-owned public contract.
- `AiRuntime/useCases/musicMentor/generateLessons.ts` now owns the public `MentorCategory` / `MentorLesson` contract for the root-exported mentor surface, and `musicMentor/queries.ts` now follows that use-case-owned contract instead of `models/MusicMentorTypes.ts`.
- A follow-up correction removed the wrong “shared use-case type” direction: consumers that only needed view/state shapes now duplicate minimal local types instead of importing broad type contracts from other module roots or `useCases/`. That correction touched the `Workspace` prompt flow, project/transport state hooks, `StatusBar`, `LlmStatusBadge`, `LaunchScreen`, `CollaborationPanel`, and `GenerativeAiPanel`.
- The same segregation pass kept going afterward in `Workspace`: `useAudioRecordingState.ts`, `useCollaborationState.ts`, `useUndoState.ts`, `useTransportState.ts`, `Transport/PanelToggles.tsx`, `AutomationLane/NotePropertyLane.tsx`, and `Inspector/TrackRoutingSection.tsx` now own tiny consumer-side view types instead of importing store-state/status aliases from other module roots.
- `Project/index.ts` no longer exports `TemplateCategory` / `ProjectTemplate`; `Workspace` now uses its own local launch-screen template shape, while `Project`'s own views keep their own local duplicated template view types.
- `AiRuntime/presentations/views/MixAnalysisPanel.tsx` was also moved back onto its private same-module `models/MixAnalysis.ts` import, and `AiBackend` / mentor lesson aliases are no longer exported type surfaces from use-case files.
- `pnpm deps:validate` passes with `✔ no dependency violations found (1599 modules, 4423 dependencies cruised)`.

## Overview

This audit was produced after the `cross-module-index-only` and `module-index-contract-only` rules were added to `.dependency-cruiser.cjs`. It documents:

1. Existing non-root `index.ts` files and what to do with them
2. Every cross-module direct-folder import (1 190 violations), grouped by target module, showing which paths must be re-exported from a new root `index.ts`
3. An architectural note on `presentations/views/` — a category that the current `module-index-contract-only` rule forbids in `index.ts` but that Workspace imports extensively

**Rule:** `index.ts` may only re-export from `useCases/`, `events/`, and `stores/`. All other folders are module-private.

---

## 1. Existing Non-Root `index.ts` Files

Only two `index.ts` files exist under `src/modules/`. Neither is at a module root.

### `AudioEngine/repositories/webMidi/index.ts`

A barrel inside a **repository** subfolder. Contents:

```ts
export { type MidiInputInfo, type WebMidiState } from '../../models/WebMidiTypes';
export { webMidiStore } from './store';
export { initWebMidi, selectMidiInput, setMidiInputTrack, setMpeEnabled, resetMidiState } from './lifecycle';
```

**Problem:** Exports types from `models/` and a store — not a use case. This is intra-module organisation for a repository directory, not a public contract surface. It does not satisfy the new module-root `index.ts` requirement.

**Action:** Keep as an intra-module convenience barrel (it is not visible cross-module and does not violate `module-index-contract-only`). AudioEngine still needs a root `index.ts` created separately.

---

### `Workspace/presentations/views/Inspector/layouts/index.ts`

A side-effect registration barrel:

```ts
import './BuiltinSynthLayout';
import './FaustInstrumentLayout';
import './HammondB3Layout';
import './effects';
```

**Action:** Keep as-is. It is intra-module (within `presentations/views/`) and not a cross-module import target.

---

## 2. Open Architectural Question: `presentations/views/`

The current `module-index-contract-only` rule forbids `index.ts` from importing `presentations/`. However, **Workspace imports views from 24 modules** — this is the primary cross-module view composition mechanism in the app.

**The tension:** Views need to be accessible cross-module but cannot legally appear in `index.ts` under the current rule.

**Options (decision needed before migrating Workspace):**

- **A.** Allow `presentations/views/` as a fourth permitted re-export layer in `index.ts` (update `module-index-contract-only` to `(useCases|events|stores|presentations/views)/`).
- **B.** Keep `presentations/views/` out of `index.ts` and let Workspace import views directly (a narrow explicit exception in the depcruiser rule for `presentations/views/` cross-module access).
- **C.** Require views to be re-exported from `index.ts` only after being promoted from within the module — meaning the module itself controls which views are public (consistent with the index-as-curator model).

Option C is most consistent with the architecture. The `module-index-contract-only` rule would need to permit `presentations/views/` as a source, but only view files, not hooks/components/context.

All 22 modules whose views Workspace directly imports are annotated below with `[view]` — these are the view-import violations, which require an architectural decision before they can be resolved.

---

## 3. Cross-Module Violations by Target Module

Format per entry: `` `path` ← ImportingModule, ... ``

Total: **1 190 violations** across **33 target modules** from **29 source modules**.

---

### AiGeneration — 13 paths, 17 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/aiStore.ts` ← AiRuntime, Workspace
- `useCases/actions/handleAiDenoiseClip.ts` ← Arrangement, Workspace
- `useCases/actions/handleGenerateAudioFallback.ts` ← AiRuntime
- `useCases/actions/handleGenerateMidiPrompt.ts` ← AiRuntime
- `useCases/actions/handleStemSeparationPreview.ts` ← AiRuntime, Workspace
- `useCases/actions/removeTask.ts` ← AiRuntime
- `useCases/actions/toggleAiPanel.ts` ← AiRuntime, Workspace
- `useCases/aiMidiHandlers.ts` ← Command
- `useCases/generateChordProgression/applyToTrack.ts` ← AiRuntime
- `useCases/generateDrumPattern/applyToTrack.ts` ← AiRuntime
- `useCases/generateMelody/applyToTrack.ts` ← AiRuntime
- `useCases/generateMidiVariations.ts` ← Workspace
- `useCases/generationHandlers.ts` ← Command

---

### AiRuntime — 22 paths, 26 unique cross-module import relationships

**Note:** 6 paths are `presentations/views/` — see §2 for architectural decision.

Needs `index.ts` exporting:

- `presentations/views/AiActionHistoryPanel.tsx` ← Workspace `[view]`
- `presentations/views/AiChangeToast.tsx` ← Workspace `[view]`
- `presentations/views/ChatPanel.tsx` ← Workspace `[view]`
- `presentations/views/GenerativeAiPanel.tsx` ← Workspace `[view]`
- `presentations/views/MixAnalysisPanel.tsx` ← Workspace `[view]`
- `presentations/views/VoiceCommandOverlay.tsx` ← Workspace `[view]`
- `stores/aiActionHistoryStore.ts` ← Workspace
- `stores/llmStatusStore.ts` ← Workspace
- `stores/voiceStatusStore.ts` ← Workspace
- `useCases/aiOrganizationHandlers.ts` ← Command
- `useCases/aiRuntimeQueries.ts` ← AiGeneration, AudioAnalysis, Workspace
- `useCases/cloudApiManagement.ts` ← Workspace
- `useCases/getProjectContext.ts` ← Workspace
- `useCases/llmOrchestration/backendResolution.ts` ← AiGeneration, Workspace
- `useCases/llmOrchestration/inference.ts` ← AiGeneration
- `useCases/llmOrchestration/lifecycle.ts` ← Workspace
- `useCases/musicMentor/generateLessons.ts` ← Arrangement
- `useCases/notifyAiChange.ts` ← Workspace
- `useCases/parsePromptToActions.ts` ← Workspace
- `useCases/promptInjection.ts` ← Arrangement, Workspace
- `useCases/runAiActionWithToast.ts` ← Arrangement
- `useCases/voiceToggle.ts` ← Workspace

---

### Arrangement — 122 paths, 211 unique cross-module import relationships

The most violated module. **8 paths are `presentations/views/`** — see §2.

Needs `index.ts` exporting:

- `presentations/views/ArrangementBar.tsx` ← Workspace `[view]`
- `presentations/views/BeatRulerBar.tsx` ← Workspace `[view]`
- `presentations/views/MarkerLane.tsx` ← Workspace `[view]`
- `presentations/views/MidiLearnButton.tsx` ← Workspace `[view]`
- `presentations/views/TimelineChromeSurface.tsx` ← Workspace `[view]`
- `presentations/views/TimelineMinimap.tsx` ← Workspace `[view]`
- `presentations/views/TimelineSurface.tsx` ← Workspace `[view]`
- `presentations/views/TrackListView.tsx` ← Workspace `[view]`
- `stores/chordTrackStore.ts` ← MIDI, Workspace
- `stores/markerStore.ts` ← CrdtDocument, Project, Workspace
- `stores/scratchPadStore.ts` ← Workspace
- `stores/takeLaneStore.ts` ← CrdtDocument, Project, Transport, Workspace
- `stores/timelineViewStore.ts` ← Command, Workspace
- `stores/trackStore.ts` ← AiGeneration, AiRuntime, AudioAnalysis, AudioEngine, Collaboration, Command, CrdtDocument, MIDI, Project, Toaster, Transport, Workspace
- `useCases/addTrack.ts` ← AiGeneration, AiRuntime, AudioAnalysis, Command, Plugin, Project, Workspace
- `useCases/audioAnalysis.ts` ← AiGeneration
- `useCases/automationQueries.ts` ← Automation, MIDI, Workspace
- `useCases/batchFeatureHandlers.ts` ← Command
- `useCases/clip/acceptGhostClip.ts` ← Workspace
- `useCases/clip/addClip.ts` ← AiGeneration, AiRuntime, AudioAnalysis, Toaster, Workspace
- `useCases/clip/dismissGhostClip.ts` ← Workspace
- `useCases/clip/duplicateClip.ts` ← Command
- `useCases/clip/duplicateClipToNextBar.ts` ← Command
- `useCases/clip/removeClip.ts` ← Workspace
- `useCases/clipEditing/createAlternativeClips.ts` ← AiGeneration
- `useCases/clipEditing/normalizeClip.ts` ← Workspace
- `useCases/clipEditing/renameClip.ts` ← Command, Workspace
- `useCases/clipEditing/reverseClip.ts` ← Workspace
- `useCases/clipEditing/setClipColor.ts` ← Workspace
- `useCases/clipEditing/setClipFade.ts` ← Workspace
- `useCases/clipEditing/setClipFollowAction.ts` ← Workspace
- `useCases/clipEditing/setClipGain.ts` ← Workspace
- `useCases/clipEditing/splitClip.ts` ← Command
- `useCases/clipEditing/trimClipEnd.ts` ← Workspace
- `useCases/clipEditing/trimClipStart.ts` ← Workspace
- `useCases/clipGainEnvelope/addGainEnvelopePoint.ts` ← Workspace
- `useCases/clipGainEnvelope/getClipGainEnvelope.ts` ← Workspace
- `useCases/clipGainEnvelope/getGainAtBeat.ts` ← Transport
- `useCases/clipGainEnvelope/removeGainEnvelopePoint.ts` ← Workspace
- `useCases/clipGainEnvelope/resetClipGainEnvelope.ts` ← Workspace
- `useCases/clipGainEnvelope/toggleClipGainEnvelope.ts` ← Workspace
- `useCases/clipHandlers.ts` ← Command
- `useCases/clipboard/copySelectedClip.ts` ← Command, Workspace
- `useCases/clipboard/copySelectedNotes.ts` ← Workspace
- `useCases/clipboard/cutSelectedClip.ts` ← Command, Workspace
- `useCases/clipboard/pasteClip.ts` ← Command, Workspace
- `useCases/clipboard/pasteNotes.ts` ← Workspace
- `useCases/comping/addTake.ts` ← Transport
- `useCases/comping/addTakeLane.ts` ← Transport
- `useCases/comping/flattenComp.ts` ← Workspace
- `useCases/comping/selectTake.ts` ← Workspace
- `useCases/comping/setCompRegion.ts` ← Workspace
- `useCases/createTrack.ts` ← GrandBoule, MIDI, Project, Toaster
- `useCases/device/addDevice.ts` ← AiRuntime, Project, Workspace
- `useCases/device/addExternalDevice.ts` ← Plugin, Workspace
- `useCases/device/bypassDevice.ts` ← Workspace
- `useCases/device/removeDevice.ts` ← Workspace
- `useCases/device/reorderDevices.ts` ← Workspace
- `useCases/device/sendManagement.ts` ← AiRuntime, Workspace
- `useCases/device/setDeviceParameter.ts` ← Bacteria, Crust, Fermenter, Gluten, Grinder, Levain, MIDI, Proof, Workspace
- `useCases/deviceHandlers.ts` ← Command
- `useCases/duplicateTrack.ts` ← Command
- `useCases/freezeBounce/freezeTrack.ts` ← Workspace
- `useCases/getAllTracks.ts` ← AiGeneration, AudioAnalysis, Automation, Bacteria, Crust, Fermenter, Gluten, GrandBoule, Grinder, Levain, MIDI, ProofChamber, Toaster, Workspace
- `useCases/getBuiltinPlugins.ts` ← Workspace
- `useCases/getNextClipId.ts` ← MIDI
- `useCases/getPlatformPlugins.ts` ← Workspace
- `useCases/getPluginById.ts` ← Workspace
- `useCases/getTrackById.ts` ← AudioEngine, Automation, Synth
- `useCases/getTrackStoreState.ts` ← AiGeneration, AiRuntime, AudioAnalysis, AudioEngine, Command, GrandBoule, MIDI, Toaster, Transport, Workspace
- `useCases/importAudioFile.ts` ← Workspace
- `useCases/isDeviceSupportedOnCurrentPlatform.ts` ← AudioEngine
- `useCases/marker/markerOperations.ts` ← Command, Workspace
- `useCases/marker/sectionOperations.ts` ← Workspace
- `useCases/mixerSnapshot/operations.ts` ← Workspace
- `useCases/newFeatureHandlers.ts` ← Command
- `useCases/preset/presetLoading.ts` ← Workspace
- `useCases/preset/presetStorage.ts` ← Workspace
- `useCases/presetHandlers.ts` ← Command
- `useCases/recording.ts` ← Transport, Workspace
- `useCases/removeTrack.ts` ← AiRuntime, Command, Workspace
- `useCases/renameTrack.ts` ← AiRuntime, Workspace
- `useCases/replaceClipAudioBuffer.ts` ← Workspace
- `useCases/resolveComping.ts` ← AudioEngine, Transport
- `useCases/restoreHandlers.ts` ← Command
- `useCases/scratchPad/captureCommit.ts` ← Workspace
- `useCases/scratchPad/scratchPadCrud.ts` ← Workspace
- `useCases/setTrackGainPan.ts` ← AiRuntime, MIDI, Workspace
- `useCases/setTrackState.ts` ← MIDI, Workspace
- `useCases/setTrackStoreState.ts` ← Command, GrandBoule, Toaster
- `useCases/songStructureDetection.ts` ← Project
- `useCases/soundPresetLibrary.ts` ← Project, Workspace
- `useCases/stretchHandlers.ts` ← Command
- `useCases/stripSilence.ts` ← AiGeneration
- `useCases/timelineQueries.ts` ← Command
- `useCases/toggleTrackState/clearSolos.ts` ← Command
- `useCases/toggleTrackState/groupTracks.ts` ← AiRuntime
- `useCases/toggleTrackState/muteTrack.ts` ← Workspace
- `useCases/toggleTrackState/selectTrack.ts` ← Workspace
- `useCases/toggleTrackState/setAutomationMode.ts` ← Workspace
- `useCases/toggleTrackState/setTrackOutput.ts` ← Workspace
- `useCases/toggleTrackState/soloTrack.ts` ← Workspace
- `useCases/toggleTrackState/soloTrackExclusive.ts` ← Workspace
- `useCases/toggleTrackState/toggleChordTrackFollow.ts` ← Workspace
- `useCases/toggleTrackState/toggleInputMonitoring.ts` ← Workspace
- `useCases/toggleTrackState/toggleSoloSafe.ts` ← Workspace
- `useCases/trackHandlers.ts` ← Command
- `useCases/trackTemplate.ts` ← Command
- `useCases/trackViewActions.ts` ← Workspace
- `useCases/trackZoom.ts` ← Command
- `useCases/updateClip.ts` ← MIDI, Transport
- `useCases/updateTrack.ts` ← MIDI
- `useCases/vca/assignToVca.ts` ← Command, Workspace
- `useCases/vca/createAndAssignVcaGroup.ts` ← Workspace
- `useCases/vca/createVcaGroup.ts` ← Command, Workspace
- `useCases/vca/getEffectiveGain.ts` ← Transport
- `useCases/vca/getVcaGroups.ts` ← Workspace
- `useCases/vca/removeFromVca.ts` ← Command, Workspace
- `useCases/vca/setVcaGain.ts` ← Command
- `useCases/vca/toggleVcaMembership.ts` ← Workspace
- `useCases/vcaFader.ts` ← Workspace
- `useCases/warp.ts` ← Workspace

---

### AudioAnalysis — 12 paths, 14 unique cross-module import relationships

Needs `index.ts` exporting:

- `useCases/analysisHandlers.ts` ← Command
- `useCases/audioAi.ts` ← AiGeneration
- `useCases/audioFeatures.ts` ← Arrangement, Workspace
- `useCases/audioToMidi.ts` ← Arrangement, Workspace
- `useCases/insertPolyphonicMidiNotes.ts` ← Workspace
- `useCases/keyDetection.ts` ← Arrangement
- `useCases/mixHealthAnalysis.ts` ← Workspace
- `useCases/pitchDetection.ts` ← Workspace
- `useCases/polyphonicAudioToMidi.ts` ← Workspace
- `useCases/referenceMixComparison/analyzeMix.ts` ← AiRuntime
- `useCases/referenceMixComparison/compareMixes.ts` ← Arrangement
- `useCases/tempoDetection.ts` ← Arrangement

---

### AudioEngine — 35 paths, 75 unique cross-module import relationships

**4 paths are `presentations/views/`** — see §2.

Needs `index.ts` exporting:

- `presentations/views/AudioDevicePicker.tsx` ← Workspace `[view]`
- `presentations/views/MidiDevicePicker.tsx` ← Workspace `[view]`
- `presentations/views/PluginBrowser.tsx` ← Workspace `[view]`
- `presentations/views/PluginScanSettings.tsx` ← Workspace `[view]`
- `stores/audioBufferCache.ts` ← AiGeneration, Arrangement, AudioAnalysis, Collaboration, Project, Transport, Workspace
- `stores/audioGraphStore.ts` ← Workspace
- `stores/audioRecordingStore.ts` ← Workspace
- `stores/linkStatusStore.ts` ← Workspace
- `useCases/advancedMetering/lufs.ts` ← Workspace
- `useCases/advancedMetering/phaseCorrelation.ts` ← Workspace
- `useCases/audioDeviceSelection.ts` ← Arrangement
- `useCases/audioEngineQueries.ts` ← Routing, Synth, Transport
- `useCases/audioRecorder/startAudioRecording.ts` ← Transport
- `useCases/audioRecorder/startInputMonitoring.ts` ← Arrangement
- `useCases/audioRecorder/stopAudioRecording.ts` ← Transport
- `useCases/audioRecorder/stopInputMonitoring.ts` ← Arrangement
- `useCases/audition.ts` ← Workspace
- `useCases/buildDeviceChain.ts` ← Arrangement
- `useCases/controlRoom/switchMonitor.ts` ← Arrangement
- `useCases/controlRoom/toggleDim.ts` ← Arrangement
- `useCases/controlRoom/toggleMono.ts` ← Arrangement
- `useCases/decodeAudioFile.ts` ← Arrangement
- `useCases/deviceControls.ts` ← Arrangement, Bacteria, Crust, Fermenter, Gluten, GrandBoule, Grinder, Project, ProofChamber, Synth, Toaster, Transport
- `useCases/engineAccess.ts` ← Arrangement, AudioAnalysis, Collaboration, GrandBoule, Project, Proof, Routing, Toaster, Transport, Workspace, Yeast
- `useCases/finalFeatureHandlers.ts` ← Command
- `useCases/initializeAudioEngine.ts` ← Workspace
- `useCases/latencyCompensation/compensation.ts` ← Arrangement, Transport, Workspace
- `useCases/nativeAiBridge.ts` ← AiGeneration, Workspace
- `useCases/offlineRender.ts` ← Project
- `useCases/scheduling.ts` ← Synth, Transport
- `useCases/setMasterGain.ts` ← Transport
- `useCases/trackAudioControls.ts` ← Arrangement, AudioAnalysis, MIDI, Project, Transport, Workspace
- `useCases/triggerLiveNoteOff.ts` ← VirtualKeyboard
- `useCases/triggerLiveNoteOn.ts` ← VirtualKeyboard
- `useCases/webMidiInput.ts` ← Arrangement, Transport, Workspace

---

### Automation — 26 paths, 35 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/automationStore.ts` ← Arrangement, Command, CrdtDocument, Project, Transport, Workspace
- `useCases/automation/addAutomationLane.ts` ← Arrangement, Workspace
- `useCases/automation/addAutomationPoint.ts` ← Arrangement, Workspace
- `useCases/automation/batchAddAutomationPoints.ts` ← Arrangement
- `useCases/automation/createAutomationLane.ts` ← Project
- `useCases/automation/duplicateClipAutomation.ts` ← Arrangement
- `useCases/automation/getAutomationValueAtBeat.ts` ← Transport
- `useCases/automation/removeAutomationLane.ts` ← Workspace
- `useCases/automation/removeAutomationPoint.ts` ← Arrangement, Workspace
- `useCases/automation/setAutomationPointCurve.ts` ← Workspace
- `useCases/automation/shiftClipAutomation.ts` ← Arrangement
- `useCases/automation/toggleAutomationVisibility.ts` ← Workspace
- `useCases/automation/toggleLaneCollapsed.ts` ← Workspace
- `useCases/automation/updateAutomationPoint.ts` ← Workspace
- `useCases/automationDrawMode.ts` ← Workspace
- `useCases/automationHandlers.ts` ← Command
- `useCases/automationRecording/isRecordingAutomation.ts` ← Transport
- `useCases/automationRecording/recordAutomationValue.ts` ← Arrangement, MIDI
- `useCases/automationRecording/releaseTouchAutomation.ts` ← Workspace
- `useCases/automationRecording/startAutomationRecording.ts` ← Transport
- `useCases/automationRecording/stopAutomationRecording.ts` ← Transport
- `useCases/automationSelection.ts` ← Workspace
- `useCases/automationShapes.ts` ← Workspace
- `useCases/automationZoom.ts` ← Workspace
- `useCases/getAutomationLanes.ts` ← AudioEngine
- `useCases/getAutomationStoreState.ts` ← Workspace

---

### Bacteria — 2 paths, 2 unique cross-module import relationships

- `presentations/views/BacteriaPanel.tsx` ← Workspace `[view]`
- `stores/bacteriaStore.ts` ← AudioEngine

---

### Collaboration — 5 paths, 8 unique cross-module import relationships

- `presentations/views/CollaborationPanel.tsx` ← Workspace `[view]`
- `presentations/views/PresenceOverlay.tsx` ← Arrangement `[view]`
- `stores/collaborationStore.ts` ← Arrangement, Transport, Workspace
- `useCases/collaboration/sessionManagement.ts` ← Arrangement, Transport
- `useCases/collaborationHandlers.ts` ← Command

---

### Command — 16 paths, 35 unique cross-module import relationships

**3 paths are `presentations/views/`** — see §2.

- `presentations/views/CommandPalette.tsx` ← Workspace `[view]`
- `presentations/views/UndoHistoryPanel.tsx` ← Workspace `[view]`
- `presentations/views/keyboardShortcutsContract.ts` ← Workspace `[view]`
- `stores/macroStore.ts` ← Workspace
- `stores/undoStore.ts` ← AiGeneration, AiRuntime, Arrangement, MIDI, Project, Workspace
- `useCases/actionLabels.ts` ← AiRuntime, Workspace
- `useCases/commandQueries.ts` ← AiGeneration, AiRuntime, Arrangement, MIDI, Workspace
- `useCases/executeAppAction.ts` ← AiRuntime, Arrangement, AudioAnalysis, CrdtDocument, Extension, Workspace
- `useCases/keyboardShortcutActions/trackShortcuts.ts` ← Workspace
- `useCases/keyboardShortcutActions/transportShortcuts.ts` ← Project, Workspace
- `useCases/macro/management.ts` ← Workspace
- `useCases/macro/playback.ts` ← Workspace
- `useCases/macro/recording.ts` ← Workspace
- `useCases/pushUndoEntry.ts` ← Arrangement, Automation, Workspace
- `useCases/trackAlternativeHandlers.ts` ← Workspace
- `useCases/undoRedo.ts` ← AiRuntime, Workspace

---

### CrdtDocument — 19 paths, 25 unique cross-module import relationships

**1 path is `presentations/views/`** — see §2.

- `presentations/views/BranchManagerDialog.tsx` ← Workspace `[view]`
- `stores/actionHistoryStore.ts` ← AiRuntime, Command
- `stores/branchStore.ts` ← Collaboration
- `useCases/crdtDocumentTypes.ts` ← Project, Routing, Transport
- `useCases/crdtProjectLifecycle.ts` ← Collaboration, Project, Workspace
- `useCases/createCrdtDoc.ts` ← Collaboration
- `useCases/getCrdtDoc.ts` ← Collaboration
- `useCases/getCrdtDocIds.ts` ← Collaboration
- `useCases/hasCrdtDoc.ts` ← Collaboration
- `useCases/mutateCrdtDoc.ts` ← Collaboration
- `useCases/projection/projectProjection.ts` ← Collaboration, Project
- `useCases/removeCrdtDoc.ts` ← Collaboration
- `useCases/replaceCrdtDoc.ts` ← Collaboration
- `useCases/restoreSnapshot.ts` ← Command
- `useCases/revertAction.ts` ← AiRuntime
- `useCases/saveSnapshot.ts` ← AiRuntime
- `useCases/semanticChangeContext.ts` ← Command
- `useCases/startCrdtAutoSave.ts` ← Project
- `useCases/subscribeToCrdtChanges.ts` ← Collaboration

---

### Crust — 1 path

- `presentations/views/CrustPanel.tsx` ← Workspace `[view]`

---

### Fermenter — 3 paths, 3 unique cross-module import relationships

- `presentations/views/FermenterPanel.tsx` ← Workspace `[view]`
- `useCases/fermenterParamBridge.ts` ← MIDI
- `useCases/fermenterQueries.ts` ← Arrangement

---

### Gluten — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GlutenPanel.tsx` ← Workspace `[view]`
- `stores/glutenStore.ts` ← AudioEngine

---

### GrandBoule — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GrandBoulePanel.tsx` ← Workspace `[view]`
- `useCases/createGrandBouleTrack.ts` ← Workspace

---

### Grinder — 2 paths, 2 unique cross-module import relationships

- `presentations/views/GrinderPanel.tsx` ← Workspace `[view]`
- `stores/grinderStore.ts` ← AudioEngine

---

### Knead — 2 paths, 2 unique cross-module import relationships

- `stores/kneadStore.ts` ← Workspace
- `useCases/dspAnalysis.ts` ← Workspace

---

### Levain — 4 paths, 5 unique cross-module import relationships

- `presentations/views/LevainPanel.tsx` ← Workspace `[view]`
- `stores/levainStore.ts` ← Arrangement, AudioEngine
- `useCases/autoLoadSamples.ts` ← AudioEngine
- `useCases/levainParamBridge.ts` ← AudioEngine

---

### MIDI — 52 paths, 73 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/midiLearnStore.ts` ← Arrangement
- `stores/midiStore.ts` ← AiGeneration, AiRuntime, Arrangement, CrdtDocument, Project, Transport, Workspace
- `useCases/arpeggiator.ts` ← Arrangement
- `useCases/chordStamps.ts` ← Workspace
- `useCases/chordTrack/addChordEvent.ts` ← Workspace
- `useCases/chordTrack/clearChordTrack.ts` ← Workspace
- `useCases/chordTrack/getChordAtBeat.ts` ← Transport
- `useCases/chordTrack/moveChordEvent.ts` ← Workspace
- `useCases/chordTrack/removeChordEvent.ts` ← Workspace
- `useCases/chordTrack/toggleChordTrack.ts` ← Workspace
- `useCases/chordTrack/updateChordEvent.ts` ← Workspace
- `useCases/chordTrackHandlers.ts` ← Command
- `useCases/createMidiNote.ts` ← AiGeneration, Arrangement, AudioEngine
- `useCases/exportMidiFile.ts` ← Arrangement, Workspace
- `useCases/formatChordName.ts` ← Workspace
- `useCases/getMidiLearnState.ts` ← AudioEngine
- `useCases/getMidiStoreState.ts` ← AudioEngine
- `useCases/grooveExtraction.ts` ← Workspace
- `useCases/importMidiFile.ts` ← Arrangement, Workspace
- `useCases/midiEvent/addMidiCC.ts` ← Workspace
- `useCases/midiEvent/addPitchBend.ts` ← Workspace
- `useCases/midiEvent/moveMidiCC.ts` ← Workspace
- `useCases/midiEvent/movePitchBend.ts` ← Workspace
- `useCases/midiEvent/removeMidiCC.ts` ← Workspace
- `useCases/midiEvent/removePitchBend.ts` ← Workspace
- `useCases/midiEvent/setNotePressure.ts` ← Workspace
- `useCases/midiEvent/setNoteSlide.ts` ← Workspace
- `useCases/midiLearn.ts` ← Arrangement, AudioEngine
- `useCases/midiNoteCrud/addMidiNote.ts` ← AiGeneration, AiRuntime, Arrangement, AudioAnalysis, Toaster, Workspace
- `useCases/midiNoteCrud/batchAddMidiNotes.ts` ← AiGeneration, AudioAnalysis
- `useCases/midiNoteCrud/getNotesForClip.ts` ← AiGeneration, Workspace
- `useCases/midiNoteCrud/moveMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/removeMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/resizeMidiNote.ts` ← Workspace
- `useCases/midiNoteCrud/setNoteProbability.ts` ← Workspace
- `useCases/midiNoteCrud/setNoteVelocity.ts` ← Workspace
- `useCases/midiNoteCrud/setNotesForClip.ts` ← AiGeneration, Arrangement
- `useCases/midiNoteCrud/shiftClipMidiNotes.ts` ← Arrangement
- `useCases/midiNoteTransforms/humanizeNotes.ts` ← AiRuntime, Workspace
- `useCases/midiNoteTransforms/invertNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/quantizeNoteLengths.ts` ← Workspace
- `useCases/midiNoteTransforms/quantizeNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/retrogradeNotes.ts` ← Workspace
- `useCases/midiNoteTransforms/scaleAllVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/scaleVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/setAllVelocities.ts` ← Workspace
- `useCases/midiNoteTransforms/transposeNotes.ts` ← Workspace
- `useCases/midiRouting.ts` ← Command, Workspace
- `useCases/patternInstanceHandlers.ts` ← Command
- `useCases/setMidiStoreState.ts` ← AudioEngine
- `useCases/strumNotes.ts` ← Workspace
- `useCases/transposeForChordTrack.ts` ← Transport

---

### Plugin — 15 paths, 21 unique cross-module import relationships

- `stores/pluginScanStore.ts` ← AudioEngine, Workspace
- `useCases/faustEngine/builtinDSP.ts` ← AudioEngine, Workspace
- `useCases/faustEngine/compilerEngine.ts` ← Arrangement, AudioEngine, Synth
- `useCases/modulatorLibrary.ts` ← Workspace
- `useCases/nodeView/toggleNodeView.ts` ← AudioEngine
- `useCases/pluginBrowserActions.ts` ← AudioEngine
- `useCases/pluginHostHandlers.ts` ← Command
- `useCases/pluginLifecycle.ts` ← Arrangement, Workspace
- `useCases/pluginQueries.ts` ← Workspace
- `useCases/pluginScan/scanning.ts` ← AudioEngine
- `useCases/proModulationEffects.ts` ← Workspace
- `useCases/pushIntegration/connectPush.ts` ← AudioEngine
- `useCases/pushIntegration/disconnectPush.ts` ← AudioEngine
- `useCases/wamPluginHost/builtinDescriptors.ts` ← AudioEngine, Workspace
- `useCases/wamPluginHost/hostOperations.ts` ← AudioEngine

---

### Project — 14 paths, 19 unique cross-module import relationships

**3 paths are `presentations/views/`** — see §2.

- `presentations/views/ArrangementSelector.tsx` ← Workspace `[view]`
- `presentations/views/ExportDialog.tsx` ← Workspace `[view]`
- `presentations/views/RecentProjectsMenu.tsx` ← Workspace `[view]`
- `stores/arrangementStore.ts` ← CrdtDocument
- `stores/projectStore.ts` ← CrdtDocument, Workspace
- `useCases/fileDialog.ts` ← Command, Workspace
- `useCases/projectPersistence/fileIO.ts` ← Command, Workspace
- `useCases/projectPersistence/helpers.ts` ← Workspace
- `useCases/projectPersistence/loadProject.ts` ← Workspace
- `useCases/projectPersistence/newProject.ts` ← Command, Workspace
- `useCases/projectPersistence/saveProject.ts` ← Command, Workspace
- `useCases/projectTemplates/templateDefinitions.ts` ← Workspace
- `useCases/songStructureHandlers.ts` ← Command
- `useCases/versionControlHandlers.ts` ← Command

---

### Proof — 3 paths, 3 unique cross-module import relationships

- `presentations/views/ProofPanel.tsx` ← Workspace `[view]`
- `stores/proofStore.ts` ← AudioEngine
- `useCases/proofParamBridge.ts` ← AudioEngine

---

### ProofChamber — 1 path

- `presentations/views/ProofChamberPanel.tsx` ← Workspace `[view]`

---

### Routing — 3 paths, 6 unique cross-module import relationships

- `useCases/busControls.ts` ← Arrangement, Transport
- `useCases/hydrateSidechainRoutes.ts` ← CrdtDocument
- `useCases/sidechain.ts` ← Arrangement, Project, Workspace

---

### SampleLibrary — 3 paths, 3 unique cross-module import relationships

- `presentations/views/LibraryBrowser.tsx` ← Workspace `[view]`
- `stores/libraryStore.ts` ← Arrangement
- `useCases/restoreLibrary.ts` ← Workspace

---

### Sampler — 1 path

- `presentations/views/SamplerPanel.tsx` ← Workspace `[view]`

---

### Scoring — 2 paths, 2 unique cross-module import relationships

- `presentations/views/ScoringPanel.tsx` ← Workspace `[view]`
- `stores/scoringStore.ts` ← AudioEngine

---

### SoundLibrary — 1 path

- `useCases/sampleDatabase/searchSamples.ts` ← Arrangement

---

### Synth — 6 paths, 10 unique cross-module import relationships

- `useCases/builtinSynth.ts` ← AudioEngine, Transport
- `useCases/cvGate/cvOutputOperations.ts` ← AudioEngine
- `useCases/drumKitSynth.ts` ← AudioEngine, Transport
- `useCases/drumSynthEngine/kitDefinitions.ts` ← AudioEngine, Transport
- `useCases/faustInstrumentScheduler.ts` ← AudioEngine, Transport
- `useCases/proSynthInstruments.ts` ← Workspace

---

### Toaster — 3 paths, 3 unique cross-module import relationships

- `presentations/views/ToasterPanel.tsx` ← Workspace `[view]`
- `useCases/createDrumTrackStack.ts` ← Workspace
- `useCases/toasterQueries.ts` ← Project

---

### Transport — 30 paths, 65 unique cross-module import relationships

Needs `index.ts` exporting:

- `stores/playheadPositionRef.ts` ← Arrangement, AudioEngine, Command, Toaster, Workspace
- `stores/tempoMapStore.ts` ← Arrangement, CrdtDocument, Project, Workspace
- `stores/timeSignatureMapStore.ts` ← Arrangement, CrdtDocument, Project
- `stores/transportStore.ts` ← AiRuntime, Arrangement, Collaboration, Command, CrdtDocument, Project, Toaster, Workspace, Yeast
- `useCases/ensureTrackStrips.ts` ← Project, Workspace
- `useCases/loopStation/toggleRecord.ts` ← Arrangement
- `useCases/loopStation/triggerScene.ts` ← Arrangement
- `useCases/punchRecording/togglePunchRecording.ts` ← Arrangement
- `useCases/setLooping.ts` ← AiRuntime, Arrangement
- `useCases/setMasterGain.ts` ← Workspace
- `useCases/setTempo.ts` ← Workspace
- `useCases/setTimeSignature.ts` ← Workspace
- `useCases/setlist/nextItem.ts` ← Arrangement
- `useCases/setlist/previousItem.ts` ← Arrangement
- `useCases/tempoMap.ts` ← Workspace
- `useCases/tempoMapping/operations.ts` ← Arrangement
- `useCases/transportControls/seekPlayhead.ts` ← Arrangement, Command
- `useCases/transportControls/setCountInBars.ts` ← Workspace
- `useCases/transportControls/setLoopRegion.ts` ← AiRuntime, Arrangement
- `useCases/transportControls/setMetronomeVolume.ts` ← Workspace
- `useCases/transportControls/stopPlayback.ts` ← Command, Workspace
- `useCases/transportControls/toggleCountIn.ts` ← Workspace
- `useCases/transportControls/toggleLoop.ts` ← Arrangement, Command, Workspace
- `useCases/transportControls/toggleMetronome.ts` ← Command, Workspace
- `useCases/transportControls/toggleOverdub.ts` ← Workspace
- `useCases/transportControls/togglePlayback.ts` ← Command, Workspace
- `useCases/transportControls/togglePunchEnabled.ts` ← Workspace
- `useCases/transportControls/toggleRecording.ts` ← Command, Workspace
- `useCases/transportHandlers.ts` ← Command
- `useCases/transportQueries.ts` ← AiGeneration, AiRuntime, Arrangement, AudioAnalysis, AudioEngine, Command, MIDI, Project, Workspace

---

### VirtualKeyboard — 1 path

- `presentations/views/VirtualKeyboard.tsx` ← Workspace `[view]`

---

### Workspace — 13 paths, 24 unique cross-module import relationships

- `stores/preferencesStore.ts` ← Arrangement
- `stores/workspaceStore.ts` ← AiGeneration, AiRuntime, Arrangement, Collaboration, Command, VirtualKeyboard
- `useCases/dialogs.ts` ← Project
- `useCases/rippleEditing.ts` ← Arrangement
- `useCases/scratchPadHandlers.ts` ← Command
- `useCases/setEditingTool.ts` ← Command
- `useCases/setTrackHeight.ts` ← Arrangement
- `useCases/setWorkspaceMode.ts` ← Arrangement
- `useCases/togglePanel/panelToggles.ts` ← AiRuntime, Arrangement, Collaboration, Command, VirtualKeyboard
- `useCases/togglePanel/zoomOperations.ts` ← Arrangement, Command
- `useCases/workspaceHandlers.ts` ← Command
- `useCases/workspaceQueries.ts` ← Arrangement, Command
- `useCases/workspaceState.ts` ← Command

---

### Yeast — 3 paths, 3 unique cross-module import relationships

- `presentations/views/YeastPanel.tsx` ← Workspace `[view]`
- `stores/yeastStore.ts` ← Transport
- `useCases/yeastSchedulingBridge.ts` ← AudioEngine

---

## 4. Summary Table

| Target Module    | Unique paths | Cross-module imports | `[view]` paths |
|------------------|-------------|----------------------|----------------|
| Arrangement      | 122         | 211                  | 8              |
| MIDI             | 52          | 73                   | 0              |
| AudioEngine      | 35          | 75                   | 4              |
| Transport        | 30          | 65                   | 0              |
| Automation       | 26          | 35                   | 0              |
| AiRuntime        | 22          | 26                   | 6              |
| CrdtDocument     | 19          | 25                   | 1              |
| AiGeneration     | 13          | 17                   | 0              |
| AudioAnalysis    | 12          | 14                   | 0              |
| Plugin           | 15          | 21                   | 0              |
| Command          | 16          | 35                   | 3              |
| Project          | 14          | 19                   | 3              |
| Workspace        | 13          | 24                   | 0              |
| Routing          | 3           | 6                    | 0              |
| Synth            | 6           | 10                   | 0              |
| Fermenter        | 3           | 3                    | 1              |
| Levain           | 4           | 5                    | 1              |
| SampleLibrary    | 3           | 3                    | 1              |
| Toaster          | 3           | 3                    | 1              |
| Collaboration    | 5           | 8                    | 2              |
| Yeast            | 3           | 3                    | 1              |
| Bacteria         | 2           | 2                    | 1              |
| GrandBoule       | 2           | 2                    | 1              |
| Gluten           | 2           | 2                    | 1              |
| Grinder          | 2           | 2                    | 1              |
| Knead            | 2           | 2                    | 0              |
| Proof            | 3           | 3                    | 1              |
| Scoring          | 2           | 2                    | 1              |
| Crust            | 1           | 1                    | 1              |
| ProofChamber     | 1           | 1                    | 1              |
| Sampler          | 1           | 1                    | 1              |
| SoundLibrary     | 1           | 1                    | 0              |
| VirtualKeyboard  | 1           | 1                    | 1              |
| **Total**        | **~468**    | **1 190**            | **~42**        |

**`[view]` paths** (42 total) require the architectural decision in §2 before they can be resolved. All other paths (≈426) may proceed immediately by creating module root `index.ts` files that re-export from `useCases/`, `events/`, and `stores/`.
