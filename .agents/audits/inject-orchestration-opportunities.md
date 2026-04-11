# `inject()` orchestration — remaining opportunities audit

## Scope

**In scope:** `src/modules/**/useCases/**/*.ts` and `src/modules/**/repositories/**/*.ts` where code **orchestrates** other modules by importing and calling their **use cases** (or `executeAppAction`), and whether those collaborators are declared on **`inject({ ... })`** maps for **`injectDependencies()`** testing.

**Out of scope:** `presentations/`, `*.spec.ts`, pure data/transformers, and **type-only** imports from use-case modules (e.g. `import { type X } from '.../useCases/...'`).

**Related docs:** `docs/01-dependency-injection.md`, `docs/architecture/03-typescript-module.md` §4.10, `docs/06-testing.md` §5.

---

## Goal

**Target state:** Orchestration surfaces (especially **`Record<string, ActionHandler>`** handler registries and multi-step flows) expose collaborators through **`inject(deps)(factory)`** so tests can substitute behavior without **`vi.mock`** on whole modules. Single-purpose use cases already follow this pattern in many modules.

---

## Relevant code paths

- `src/infra/di/inject.ts`, `src/infra/di/testing/injectDependencies.ts`
- `src/modules/**/useCases/**/*Handlers.ts` — command / feature handler maps; **`timelineViewActions.ts`** — presentation delegate passthroughs
- `src/modules/Command/useCases/executeAppAction.ts` — central dispatcher (`inject({ logger })`)
- `src/modules/Transport/useCases/scheduling/*.ts` — playhead schedulers
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` — live MIDI adapter

---

## Current behavior

### A. Handler registries — already migrated to `inject()` (baseline)

These **`*Handlers.ts`** files use **named `execute*`** functions with **`inject({ ... })`** and wire `analysisHandlers` / `trackHandlers` / `clipHandlers` / `workspaceHandlers` / `scratchPadHandlers` / `songStructureHandlers` / `versionControlHandlers` / `trackAlternativeHandlers` / **`transportHandlers`** / **`automationHandlers`** / **`deviceHandlers`** / **`presetHandlers`** / **`restoreHandlers`** / **`stretchHandlers`** / **`batchFeatureHandlers`** / **`undoTreeHandlers`** / **`newFeatureHandlers`** / **`finalFeatureHandlers`** / **`pluginHostHandlers`** / **`collaborationHandlers`** / **`generationHandlers`** / **`aiMidiHandlers`** / **`macroHandlers`** / **`chordTrackHandlers`** / **`patternInstanceHandlers`** / **`aiOrganizationHandlers`** patterns.

### B. Handler registries — **no `inject()`** (grep: `inject(` absent)

*No remaining entries — the former §B `*Handlers.ts` list for this audit is fully migrated.*

**Special cases**

- **`Command/useCases/editActionHandlers.ts`** — Uses **`inject()`** on **individual** exports (`selectAllClips`, `deselectAllClips`), not a `Record` of handlers. Compliant; different shape.
- **`Workspace/presentations/hooks/useAppEventHandlers.ts`** — Presentation hook; out of scope for use-case `inject` audit.

### C. Non-registry orchestrators (call `executeAppAction` or many use cases)

| File | Approx. lines | `inject`? |
|------|---------------|-----------|
| `Collaboration/useCases/collaboration/sessionManagement.ts` | ~800 | **Done** — `createSession` / `joinSession` / `leaveSession` use **`sessionManagementDependencies`** (`setupProjectionBridge`, CRDT doc helpers, `persistCrdtProject`, `getAudioContext`); branch sync + asset decode thread deps through helpers; `sessionManagement.spec.ts` (smoke) |
| `AiRuntime/useCases/dsoEditor/compileDso.ts` | ~1050 | **Done** — **`executeDsos`** = `inject(compileDsoExecutionDependencies)`; `executeSingleDso(deps, …)` replaces dynamic `import()` with static collaborators; `compileDso.spec.ts` (smoke); `resolveDsoNames` / `validateDsos` remain store-backed parsers |
| `AiRuntime/useCases/aiHistoryActions.ts` | ~35 | **Done** — `inject({ executeAppAction, undoStore, markGroupReverted })`; see **Resolved (this audit)** |
| `AiRuntime/useCases/sendChatMessage.ts` | (large) | **Done** — `inject({ ... })` over orchestration deps; `sendChatMessage.spec.ts`; see **Resolved** |
| `CrdtDocument/useCases/revertAction.ts` | (small) | **Done** — `inject({ executeAppAction, actionHistoryStore, markEntryReverted })`; see **Resolved (this audit)** |
| `Command/useCases/undoRedo.ts` | (small) | **Done** — `undo` / `redo` use `inject({ undoStore, executeAppAction })`; `undoToIndex` delegates to them; see **Resolved** |
| `Project/useCases/projectPersistence/newProject.ts` | ~95 | **Done** — `inject({ stopPlayback, resetAudioGraph, createCrdtProject, resetModuleStoresToDefault, addTrack, clearUndoHistory, startCrdtAutoSave, removeProjectJson })`; `newProject.spec.ts`; see **Resolved** |
| `Project/useCases/projectPersistence/fileIO.ts` | ~280 | **Done** — `applyImportedProjectData`, `exportProjectFile`, `importProjectFile`, `importProjectFromNativePath`, `pickAndImportProjectFile`; `fileIO.spec.ts`; see **Resolved** |

**Thin delegates (presentation → use case wiring)**

- `AiRuntime/useCases/aiPanelActions.ts` — **`inject({ executeAppAction })`**, **`inject({ undo })`**, **`inject({ toggleChatPanel })`**; `aiPanelActions.spec.ts`.
- `Arrangement/useCases/timelineViewActions.ts` — Per-export **`inject({ …Impl })`** passthroughs for timeline presentation (clip, clipboard, automation, transport, etc.); `timelineViewActions.spec.ts`.
- `Arrangement/useCases/trackViewActions.ts` — **`setWorkspaceMode`**, **`getAudioDevices`**, **`decodeAudioFile`** (replaces pure re-exports); `trackViewActions.spec.ts`.

### D. Repository layer → use case imports

| File | Nature |
|------|--------|
| `AudioEngine/repositories/webMidi/messageHandlers.ts` | **`inject()`** on exported handlers + shared **`midiMessageHandlerDependencies`** — aligned |
| `AudioEngine/repositories/faustDeviceFactory.ts` | **`createFaustDevice`** uses `inject({ logger, compileFaustDSP, createFaustNode })` — aligned |
| `Arrangement/repositories/presets/factoryPresets.ts` | Imports **`FERMENTER_PRESETS`** from Fermenter **queries** as **data**, not orchestration |
| `AudioEngine/repositories/offlineScheduler/automationScheduling.ts` | **Type-only** `TempoChange` from `transportQueries` |

### E. Transport schedulers (backlog)

- **`scheduleMidiNotes.ts`** — **Done** — **`inject(scheduleMidiNotesDependencies)`**; **`scheduleMidiNotes.spec.ts`** (smoke); transport parameter **`TransportState`**.
- **`scheduleAudioClips.ts`** — **Done** — **`inject(scheduleAudioClipsDependencies)`**; **`scheduleAudioClips.spec.ts`** (smoke); transport parameter typed as **`TransportState`**.
- **`playheadScheduler.ts`** — **Done** — **`inject(playheadSchedulerDependencies)`** on **`startPlayheadScheduler`** / **`stopPlayheadScheduler`**; **`playheadScheduler.spec.ts`** (smoke).

### F. Demo / script builders

- **`Project/useCases/demoProjects/**`** — **Out of scope** for mandatory **`inject()`** follow-up in this audit. Large **`create*Demo.ts`** scripts (Sweet Dreams, Nebula Drift, Resonance, Synthwave, etc.) are procedural templates; do not queue them for migration unless a spec explicitly requires it. Shared **`demoUtils.ts`** orchestration is already listed under **Resolved** for **`applyPreset`**, **`generateDemoDrumBuffer`**, **`syncArrangement`**.

### G. When a file may omit `inject()` (narrow)

Only these are **out of scope** for mandatory **`inject()`**:

- **Pure / store-local** — math, parsing, single-store reads/writes with **no** calls to other modules’ **use cases** or **engine** entrypoints.
- **Repositories that only touch metal** — Web Audio / Tauri / FS; cross-module **type-only** imports do not force `inject`.
- **Static data** — importing **query constants** without invoking behavior.
- **Demo project scripts** — **`demoProjects/**/create*Demo.ts`** (see §F); not part of the **Remaining queue**.

Everything else that **orchestrates** (including **`*ParamBridge.ts`** that forwards to other use cases, **Yeast** bridge, **Proof** bridges, **Instrument** surfaces) belongs in the **remaining queue** in **Migration policy** until listed under **Resolved**.

---

## Findings

1. **Two handler patterns coexist:** (a) **`inject` + `execute*`** per action — testable via `injectDependencies`; (b) **inline `execute: (a) => { ... }`** — collaborators hidden unless `vi.mock`’d.
2. **`transportHandlers.ts`** — migrated to pattern (a); **`transportHandlers.spec.ts`** smoke-tests `injectDependencies`.
3. **Handler registry migration (§B)** — completed for all files that were listed in this audit’s §B table; new handler maps should follow **`inject` + `execute*`** from the start.
4. **`sessionManagement.ts` and `compileDso.ts`** — **injection boundaries added** (exported dependency maps + `inject()` on session entrypoints / `executeDsos`); internal switch and peer plumbing remain in-module by design.
5. **`aiHistoryActions.revertAiActionGroup`** — migrated to `inject`; **`aiHistoryActions.spec.ts`** added.
6. **Repository `messageHandlers`** — addressed with **`inject()`** on handlers (see §3 open issue).

---

## Priorities

1. **New `*Handlers.ts` files** — Use **`inject` + `execute*`** + `injectDependencies` smoke tests from creation; §B table in this audit is empty until a gap is found.
2. **Further CRDT / collaboration** — add **facade** types only when tests need to mock entire subsystems beyond current dependency maps; **`projectCrdtToStores`**, **`importSdawFile`**, **`mergeDocumentBundle`** already use `inject()` (see **Resolved**).

---

## Open issues

### 1. Handler registries without `inject()` (§B table)

**Status:** The §B table is **empty** — prior entries are migrated; see **Resolved (this audit)**.

**If a new handler map regresses:** introduce `export const executeFoo = inject({ ... })(...)`, assign `execute: executeFoo`, and add `injectDependencies` smoke tests.

---

### 2. Large orchestrators (`sessionManagement.ts`, `compileDso.ts`)

**Status:** **Addressed** — see §C table and **Resolved (this audit)**. **`sessionManagementDependencies`** / **`compileDsoExecutionDependencies`** are exported for **`injectDependencies`**; further **facade** extraction is a follow-up when tests need narrower seams.

---

### 3. Web MIDI `messageHandlers` (repository)

**Problem:** Repository imports many application use cases.

**Representative file:** `AudioEngine/repositories/webMidi/messageHandlers.ts`.

**Status:** **`messageHandlers.ts`** uses **`inject({ ... })`** on **`handleNoteOff`**, **`handleNoteOn`** (deps include **`handleNoteOff`** for velocity-0 delegation), **`handleCC`**, **`handleChannelPressure`** (`inject({})` — no collaborators), **`handlePitchBend`**, and **`onMidiMessage`** (deps: the injectable handler functions). Shared map **`midiMessageHandlerDependencies`** lists use-case collaborators; **`midiMessagePorts.ts` removed** in favor of canonical `inject()`.

**Tests:** Use **`injectDependencies`** on each exported handler (or **`onMidiMessage`**) with mocks for the dependency map keys.

---

### 4. Transport schedulers

**Status:** **`scheduleAudioClips`**, **`scheduleMidiNotes`**, and **`playheadScheduler`** — migrated (see **Resolved**).

---

## Open questions

- [x] **`aiPanelActions.ts`** — Wrapped in **`inject()`** per export (`runAppAction`, `undoLastAction`, `toggleChat`); see **Resolved (this audit)**.
- [x] For **`compileDso.ts`**, **`executeDsos`** uses **`inject(compileDsoExecutionDependencies)`**; **`executeDsoEdit`** still injects **`executeDsos`** for orchestration tests. Splitting DSO ops into smaller files remains a separate refactor.

---

## Risks

- **Test brittleness:** Handler registries without `inject` encourage module-level `vi.mock`, which breaks when imports move.
- **Circular imports:** Wiring `executeAppAction` into `inject` for handlers that `executeAppAction` already dispatches must follow existing patterns (e.g. `analysisHandlers` / `autoFixMix`).
- **Scope creep:** further refactors of collaboration / DSO internals should stay phased; add **facades** when tests need them, not as a substitute for **`inject()`** on orchestrators.

---

## Suggested approaches

- Migrate **one handler file per PR/session**; run `pnpm typecheck` and targeted tests after each.
- Copy the **`trackHandlers` / `workspaceHandlers`** shape: `ExtractAction` types, one `execute*` per action, `satisfies ActionHandler<...>` unchanged.
- For **repositories**, prefer **ports** over growing static import lists in `messageHandlers`.

---

## Resolved (prior baseline — not part of this audit’s open work)

The following were already addressed in the **earlier inject migration** (handler maps and use cases such as `analyzeMix`, `loadRecentProject`, `createFaustDevice`, `trackHandlers`, `clipHandlers`, `workspaceHandlers`, etc.).

## Resolved (this audit — migration sessions)

- **`Transport/useCases/transportHandlers.ts`** — All transport command actions use `execute*` + `inject`; `transportHandlers.spec.ts` (smoke tests).
- **`AiRuntime/useCases/aiHistoryActions.ts`** — `revertAiActionGroup` = `inject({ executeAppAction, undoStore, markGroupReverted })`; `aiHistoryActions.spec.ts`.
- **`Automation/useCases/automationHandlers.ts`** — Six automation actions (`scale` / `stretch` / `invert` / `reverse` / `thin` / `quantize`); `automationHandlers.spec.ts`.
- **`Arrangement/useCases/deviceHandlers.ts`** — Device / send / MPE / latency / sidechain handlers; `deviceHandlers.spec.ts`.
- **`Arrangement/useCases/presetHandlers.ts`** — `loadPreset` / `savePreset`; `presetHandlers.spec.ts`.
- **`Arrangement/useCases/restoreHandlers.ts`** — `restoreTrack` / `restoreClip` (inverse actions); `restoreHandlers.spec.ts`.
- **`Arrangement/useCases/stretchHandlers.ts`** — Stretch mode / ratio / fit-to-beats; `stretchHandlers.spec.ts`.
- **`Arrangement/useCases/batchFeatureHandlers.ts`** — Search samples, comp group, punch/loop record, scenes, setlist, tempo detect, adjustment layer; `batchFeatureHandlers.spec.ts`.
- **`Command/useCases/undoTreeHandlers.ts`** — Toggle undo tree / label branch; `undoTreeHandlers.spec.ts`.
- **`Arrangement/useCases/newFeatureHandlers.ts`** — Fills, transitions, reference mix, control room, mentor tips; `newFeatureHandlers.spec.ts`.
- **`AudioEngine/useCases/finalFeatureHandlers.ts`** — Transients stub, node view, control surface, CV/Push, RAVE, warping; `finalFeatureHandlers.spec.ts`.
- **`Plugin/useCases/pluginHostHandlers.ts`** — Scan / load external plugin; `pluginHostHandlers.spec.ts`.
- **`Collaboration/useCases/collaborationHandlers.ts`** — Create / join / leave session; `collaborationHandlers.spec.ts`.
- **`AiGeneration/useCases/generationHandlers.ts`** — Drum / melody / chords / groove; `generationHandlers.spec.ts`.
- **`AiGeneration/useCases/aiMidiHandlers.ts`** — AI MIDI, analysis, generate audio, stem separation; `aiMidiHandlers.spec.ts`.
- **`Command/useCases/macroHandlers.ts`** — Macro record / play / delete; `macroHandlers.spec.ts`.
- **`MIDI/useCases/chordTrackHandlers.ts`** — Chord track CRUD; `chordTrackHandlers.spec.ts`.
- **`MIDI/useCases/patternInstanceHandlers.ts`** — Pattern instance create / detach; `patternInstanceHandlers.spec.ts`.
- **`AiRuntime/useCases/aiOrganizationHandlers.ts`** — Auto-organize project; `aiOrganizationHandlers.spec.ts`.
- **`AiRuntime/useCases/aiPanelActions.ts`** — Thin delegates `runAppAction` / `undoLastAction` / `toggleChat`; `aiPanelActions.spec.ts`.
- **`CrdtDocument/useCases/revertAction.ts`** — `revertAction`; `revertAction.spec.ts`.
- **`Command/useCases/undoRedo.ts`** — `undo` / `redo`; `undoRedo.spec.ts`.
- **`AiRuntime/useCases/sendChatMessage.ts`** — Full orchestration map (chat store, backends, `executeAppAction`, etc.); `sendChatMessage.spec.ts`.
- **`Arrangement/useCases/timelineViewActions.ts`** — Timeline presentation delegate surface; `timelineViewActions.spec.ts`.
- **`Arrangement/useCases/trackViewActions.ts`** — Track sidebar / input / decode delegates; `trackViewActions.spec.ts`.
- **`AiRuntime/useCases/dsoEditor/executeDsoEdit.ts`** — `inject({ logger, executeDsos })`; `commitDsos(..., runDsos)` so DSO execution is mockable without changing `compileDso.ts`.
- **`CrdtDocument/useCases/projection/projectProjection.ts`** — **`projectCrdtToStores`** = `inject({ hydrateSidechainRoutes })`.
- **`CrdtDocument/useCases/crdtMerge.ts`** — **`importSdawFile`** (`forkProjectBranch`, `projectCrdtToStores`, `persistCrdtProject`, `mergeBundle`); **`mergeDocumentBundle`** (`projectCrdtToStores`, `persistCrdtProject`, `mergeBundle`); **`mergeDocumentBundleFromRepo`** wrapper for repo merge.
- **`Project/useCases/projectPersistence/loadProject.ts`** — **`loadProject`** = `inject({ loadCrdtProject, createCrdtProject, projectCrdtToStores, startCrdtAutoSave, clearUndoHistory })`.
- **`Project/useCases/projectPersistence/saveProject.ts`** — **`saveProject`** = `inject({ persistCrdtProject, addToRecentProjects })`.
- **`Project/useCases/projectPersistence/newProject.ts`** — **`newProject`** = `inject({ stopPlayback, resetAudioGraph, createCrdtProject, resetModuleStoresToDefault, addTrack, clearUndoHistory, startCrdtAutoSave, removeProjectJson })`; `newProject.spec.ts` (smoke).
- **`Project/useCases/projectPersistence/fileIO.ts`** — **`applyImportedProjectData`** (`stopPlayback`, `resetAudioGraph`, `hydrateModuleStoresFromProjectData`, `getAudioContext`, `audioBufferCache`, `verifyAudioBufferReferences`, `clearUndoHistory`); **`exportProjectFile`** (`syncCurrentArrangementToStore`, `downloadProjectFile`, `notifyUser`, `getAllSidechainRoutes`, `audioBufferCache`); **`importProjectFile`** / **`importProjectFromNativePath`** / **`pickAndImportProjectFile`** wired on those seams; `fileIO.spec.ts`.
- **`Collaboration/useCases/collaboration/sessionManagement.ts`** — **`createSession`**, **`joinSession`**, **`leaveSession`** use **`inject(sessionManagementDependencies)`**; **`sessionManagementDependencies`** exported; branch sync + **`resolveAssetForClips`** take **`SessionManagementDeps`**; `sessionManagement.spec.ts` (smoke).
- **`AiRuntime/useCases/dsoEditor/compileDso.ts`** — **`executeDsos`** = **`inject(compileDsoExecutionDependencies)`**; **`compileDsoExecutionDependencies`** exported; dynamic imports removed from **`executeSingleDso`**; `compileDso.spec.ts` (smoke).
- **`AiRuntime/useCases/runAiActionWithToast.ts`** — **`runAiActionWithToast`** = `inject({ notifyUser, notifyAiChange })`; `runAiActionWithToast.spec.ts`.
- **`AudioAnalysis/useCases/mixHealthAnalysis.ts`** — **`mixHealthAnalysis`** = `inject({ getTrackStoreState, streamCloudChatCompletion, summarizeFeatures })`; `mixHealthAnalysis.spec.ts` (smoke).
- **`MIDI/useCases/importMidiFile.ts`** — **`importMidiFile`** = `inject(importMidiFileDependencies)` (track/MIDI stores + undo + `createTrack` / `getNextClipId` / `setTrackState`).
- **`Routing/useCases/busControls.ts`** — **`ensureBusStrip`**, **`setBusGain`**, **`setSend`** each `inject({ …Engine })` over **`engineAccess`**.
- **`Routing/useCases/sidechain.ts`** — **`addSidechainRoute`**, **`removeSidechainRoute`**, **`setSidechainRoutes`** = `inject(sidechainRouteMutationDependencies)`; store reads (**`getAllSidechainRoutes`**, etc.) stay plain.
- **`Transport/useCases/ensureTrackStrips.ts`** — **`ensureTrackStrips`** = `inject(ensureTrackStripsDependencies)` (track store + **`busControls`** + track audio / device).
- **`Workspace/useCases/rippleEditing.ts`** — **`toggleRippleEditing`** remains Workspace-owned and uses `inject({ workspaceStore })`; ripple-delete plan/apply/undo moved to `Arrangement/useCases/rippleDelete/*` so the Arrangement write path no longer lives in Workspace.
- **`Command/useCases/pushUndoEntry.ts`** — **`pushUndoEntry`** = `inject({ pushUndo })`.
- **`Arrangement/useCases/timelineInteractions/setPlayheadFromClick.ts`** — **`inject({ getTransportState, updateTransportState })`**; **`setPlayheadFromClick.spec.ts`** (smoke).
- **`Arrangement/useCases/clipboard/copySelectedClip.ts`** / **`cutSelectedClip.ts`** — **`inject({ getWorkspaceState })`** / **`inject({ getWorkspaceState, removeClip })`**; **`copySelectedClip.spec.ts`** / **`cutSelectedClip.spec.ts`** (smoke).
- **`Arrangement/useCases/clipboard/pasteClip.ts`** — **`inject({ getTrackState, getTransportState, addClip, createMidiNote })`**; **`pasteClip.spec.ts`** (smoke).
- **`Arrangement/useCases/clipboard/pasteNotes.ts`** — already **`inject({ createMidiNote })`**; **`pasteNotes.spec.ts`** (smoke).
- **`Project/useCases/arrangement.ts`** — **`switchArrangement`**, **`createArrangement`**, **`duplicateArrangement`**, **`renameArrangement`** use **`inject(arrangementOrchestrationDependencies)`** (`stopPlayback`, **`markDirty`**); **`syncCurrentArrangementToStore`** stays plain; **`arrangement.spec.ts`** (smoke).
- **`Arrangement/useCases/audioAnalysis.ts`** — **`detectKey`** = **`inject(detectKeyDependencies)`**; **`audioToMidi`** = **`inject(audioToMidiDependencies)`**; **`detectTempo`** unchanged (buffer math only); **`audioAnalysis.spec.ts`** (smoke).
- **`AudioAnalysis/useCases/insertPolyphonicMidiNotes.ts`** — **`inject(insertPolyphonicMidiNotesDependencies)`**; **`insertPolyphonicMidiNotes.spec.ts`** (smoke).
- **`AudioAnalysis/useCases/audioToMidi.ts`** — **`inject(audioAnalysisAudioToMidiDependencies)`**; **`audioToMidi.spec.ts`** (smoke).
- **`Plugin/useCases/pluginBrowserActions.ts`** — **`inject(pluginBrowserActionsDependencies)`**; **`pluginBrowserActions.spec.ts`** (smoke).
- **`MIDI/useCases/patternInstance.ts`** — pattern instance exports use **`inject(patternInstanceDependencies)`**; **`patternInstance.spec.ts`** (smoke).
- **`MIDI/useCases/midiNoteTransforms/scaleVelocities.ts`** — **`inject(scaleVelocitiesDependencies)`**; **`scaleVelocities.spec.ts`** (smoke).
- **`Arrangement/useCases/freezeBounce/renderOffline.ts`** — **`inject(renderTrackOfflineDependencies)`**; **`renderOffline.spec.ts`** (smoke).
- **`Collaboration/useCases/automergeSync.ts`** — **`AutomergeSync`** accepts optional **`AutomergeSyncDependencies`** (constructor injection; no `inject()` wrapper on the class); **`automergeSync.spec.ts`** (smoke).
- **`Command/useCases/selectionHelpers.ts`** — selection + marker helpers use **`inject(selectionHelpersDependencies)`**; **`selectionHelpers.spec.ts`** (smoke).
- **`AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts`** — **`inject(handleGenerateMidiPromptDependencies)`**; **`handleGenerateMidiPrompt.spec.ts`** (smoke).
- **`AiRuntime/useCases/musicMentor/generateLessons.ts`** — **`inject(generateMentorLessonsDependencies)`** (cached **`analyzeMix`**); **`generateLessons.spec.ts`** (smoke).
- **`AudioEngine/useCases/deviceControls.ts`** — **`addDeviceToStrip`** = **`inject(addDeviceToStripDependencies)`**; **`deviceControls.spec.ts`** (smoke).
- **`AudioEngine/useCases/latencyCompensation/compensation.ts`** — **`getTrackLatency`**, **`getMaxTrackLatency`**, **`getCompensationDelay`**, **`getLatencyReport`** use exported dependency maps (`trackLatencyDependencies`, **`maxTrackLatencyDependencies`**, **`compensationDelayDependencies`**, **`latencyReportDependencies`**); **`compensation.spec.ts`** (smoke).
- **`AiGeneration/useCases/actions/handleGenerateAudioFallback.ts`** — static **`audioAi`** imports; **`inject(handleGenerateAudioFallbackDependencies)`**; dynamic import removed; **`handleGenerateAudioFallback.spec.ts`** (smoke).
- **`Automation/useCases/automationSelection.ts`** — **`deleteSelectedPoints`** = **`inject(deleteSelectedPointsDependencies)`**; **`automationSelection.spec.ts`** (smoke).
- **`AiGeneration/useCases/actions/handleAiDenoiseClip.ts`** — **`inject(handleAiDenoiseClipDependencies)`**; **`handleAiDenoiseClip.spec.ts`** (smoke).
- **`AiGeneration/useCases/actions/handleStemSeparationPreview.ts`** — static **`separateStems`** from **`audioAi`**; duplicate **`isTauri`** branches removed; **`inject(handleStemSeparationPreviewDependencies)`**; **`handleStemSeparationPreview.spec.ts`** (smoke).
- **`Automation/useCases/automationRecording/startAutomationRecording.ts`** / **`stopAutomationRecording.ts`** — **`inject({ getAllTracks })`**; **`startAutomationRecording.spec.ts`** / **`stopAutomationRecording.spec.ts`** (smoke).
- **`AiGeneration/useCases/generateChordProgression/applyToTrack.ts`**, **`generateDrumPattern/applyToTrack.ts`**, **`generateMelody/applyToTrack.ts`** — **`inject({ addClip, addMidiNote })`**; matching **`applyToTrack.spec.ts`** per folder (smoke).
- **`AiGeneration/useCases/llmMidiGeneration.ts`** — **`inject(generateMidiViaLlmDependencies)`**; pattern fallback uses injected **`filterTemplates`** / **`patternTemplates`**; **`llmMidiGeneration.spec.ts`** (smoke).
- **`AiGeneration/useCases/generateMidiVariations.ts`** — **`inject(generateMidiVariationsDependencies)`**; **`generateMidiVariations.spec.ts`** (smoke).
- **`AiGeneration/useCases/grooveTemplate/operations.ts`** — **`extractGroove`** / **`applyGroove`** = **`inject(grooveTemplateOperationsDependencies)`**; **`grooveTemplate/operations.spec.ts`** (smoke).
- **`Automation/useCases/automation/thinAutomationPoints.ts`** — **`inject(thinAutomationPointsDependencies)`**; **`thinAutomationPoints.spec.ts`** (smoke).
- **`Toaster/useCases/exportPatternToTimeline.ts`** — **`inject(exportPatternToTimelineDependencies)`** (`getAllTracks`, **`addMidiNote`**, **`addClip`**, **`playheadPositionRef`**); **`exportPatternToTimeline.spec.ts`** (smoke).
- **`Toaster/useCases/loadToasterKit.ts`** — **`getToasterControls`** = **`inject(getToasterControlsDependencies)`** (`getAllTracks`, **`getTrackStrip`**); **`loadToasterKit.spec.ts`** (smoke).
- **`Toaster/useCases/triggerPad.ts`** — **`triggerToasterPad`** = **`inject(triggerToasterPadDependencies)`** (`getAllTracks`, **`ensureTrackStrip`**); **`triggerPad.spec.ts`** (smoke).
- **`Toaster/useCases/noteRepeat.ts`** — **`startNoteRepeat`** = **`inject(startNoteRepeatDependencies)`** (`getAudioTime`, **`triggerToasterPad`**); **`stopNoteRepeat`** / **`isNoteRepeating`** unchanged; **`noteRepeat.spec.ts`** (smoke).
- **`Toaster/useCases/sixteenLevels.ts`** — **`trigger16Level`** = **`inject(trigger16LevelDependencies)`** (`triggerToasterPad`, **`getFirstToasterDeviceId`**, **`setToasterPadParam`**); **`sixteenLevels.spec.ts`** (smoke).
- **`Toaster/useCases/toasterParamBridge.ts`** — **`getFirstToasterDeviceId`**, **`setToasterPadParam`**, **`setToasterKitParam`**, **`setPadEngineImmediate`** each **`inject(...)`** over **`getAllTracks`** / **`getTrackStrip`** / store updaters; **`toasterParamBridge.spec.ts`** (smoke).
- **`Toaster/useCases/sequencerPlayback.ts`** — **`startSequencer`** = **`inject(startSequencerDependencies)`** (`getAudioTime`, **`getFirstToasterDeviceId`**, **`setToasterPadParam`**, **`setPadEngineImmediate`**, **`triggerToasterPad`**); **`setFillActive`** / **`stopSequencer`** unchanged; **`sequencerPlayback.spec.ts`** (smoke).
- **`Transport/useCases/scheduling/scheduleAudioClips.ts`** — **`inject(scheduleAudioClipsDependencies)`** (stores, **`audioBufferCache`**, engine helpers, **`resolveClipsWithComping`**, **`getGainAtBeat`**, **`notifyUser`**, **`scheduleFrozenTrack`**, collaboration, **`getTempoAtBeat`**); **`scheduleAudioClips.spec.ts`** (smoke).
- **`Transport/useCases/scheduling/scheduleMidiNotes.ts`** — **`inject(scheduleMidiNotesDependencies)`** (stores, **`resolveClipsWithComping`**, **`resolveDrumKit`** / **`resolveDrumKitDef`** / **`scheduleFrozenTrack`**, Yeast, synth/drum helpers, **`getCompensationDelay`**, etc.); **`scheduleMidiNotes.spec.ts`** (smoke).
- **`Transport/useCases/playheadScheduler.ts`** — **`inject(playheadSchedulerDependencies)`** on **`startPlayheadScheduler`** and **`stopPlayheadScheduler`** (transport/playhead stores, **`scheduleMidiNotes`**, **`scheduleAudioClips`**, metronome, automation, recording, **`getAudioContext`**, etc.); **`playheadScheduler.spec.ts`** (smoke).
- **`Transport/useCases/scheduling/scheduleMetronome.ts`** — **`inject(scheduleMetronomeDependencies)`**; **`resetMetronomeBeat`** unchanged (module **`lastMetronomeBeat`**); transport arg **`TransportState`**; **`scheduleMetronome.spec.ts`** (smoke).
- **`Transport/useCases/scheduling/applyAutomation.ts`** — **`applyVcaGains`** and **`applyAutomation`** share **`inject(applyAutomationSideEffectsDependencies)`**; **`ensureTrackStrip`** re-export preserved; **`applyAutomation.spec.ts`** (smoke).
- **`AudioEngine/useCases/audition.ts`** — **`playAuditionNote`** = **`inject(playAuditionNoteDependencies)`** (engine, **`getTrackById`**, drum/synth helpers, **`trackStore`**); **`audition.spec.ts`** (smoke).
- **`Proof/useCases/proofParamBridge.ts`** — **`setProofParam`** = **`inject(setProofParamDependencies)`** (`persistDeviceParam`); other bridge exports unchanged in this batch; **`proofParamBridge.spec.ts`** (smoke).
- **`Yeast/useCases/yeastSchedulingBridge.ts`** — **`processYeastMidi`** = **`inject(processYeastMidiDependencies)`**; **`processRealtimeMidiInput`** / **`yeastPanic`** unchanged; **`yeastSchedulingBridge.spec.ts`** (smoke).
- **`Sampler/useCases/handleFileDrop.ts`** — **`handleSamplerFileDrop`** = **`inject(handleSamplerFileDropDependencies)`**; **`handleFileDrop.spec.ts`** (smoke).
- **`Collaboration/useCases/collaborationQueries.ts`** — **`getCollaborationStoreValue`** = **`inject(getCollaborationStoreValueDependencies)`**; **`collaborationQueries.spec.ts`** (smoke).
- **`Grinder/useCases/grinderParamBridge.ts`** — **`setGrinderParamWithAudio`** and **`loadGrinderPatchWithAudio`** each **`inject(grinderParamBridgeDependencies)`** (`getAllTracks`, **`updateDeviceParam`**, **`persistDeviceParam`**); **`grinderParamBridge.spec.ts`** (smoke).
- **`AudioEngine/useCases/initializeAudioEngine.ts`** — **`initializeAudioEngine`** = **`inject(initializeAudioEngineDependencies)`** (engine, transport query, mic permission, WAM/Faust registration, **`initWAMEnvironment`**); **`initializeAudioEngine.spec.ts`** (smoke).
- **`Fermenter/useCases/fermenterParamBridge.ts`** — **`setFermenterParamWithAudio`** / **`loadFermenterPatchWithAudio`** = **`inject(fermenterParamBridgeDependencies)`**; **`fermenterParamBridge.spec.ts`** (smoke).
- **`ProofChamber/useCases/proofChamberParamBridge.ts`** — **`updateProofChamberParam`** = **`inject(proofChamberParamBridgeDependencies)`**; **`proofChamberParamBridge.spec.ts`** (smoke).
- **`Bacteria/useCases/bacteriaParamBridge.ts`** — **`loadBacteriaPatchWithAudio`**, **`setBacteriaParamWithAudio`**, **`setBacteriaBandParamWithAudio`** = **`inject(bacteriaParamBridgeDependencies)`**; **`bacteriaParamBridge.spec.ts`** (smoke).
- **`Sampler/useCases/samplerParamBridge.ts`** — **`setSamplerParamThrottled`** / **`setSamplerParamImmediate`** = **`inject(samplerParamBridgeDependencies)`** (`setSamplerParam`, **`samplerStore`**); **`samplerParamBridge.spec.ts`** (smoke).
- **`Levain/useCases/levainParamBridge.ts`** — **`levainBridge`** = **`inject(levainBridgeDependencies)`** (`getAllTracks`, **`persistDeviceParam`**, **`autoLoadLevainSamples`**); **`createLevainBridge`** holds rAF maps + active device; named exports delegate to **`levainBridge()`**; **`levainParamBridge.spec.ts`** (smoke).
- **`Command/useCases/keyboardShortcutActions/transportShortcuts.ts`**, **`trackShortcuts.ts`**, **`workspaceShortcuts.ts`** — each delegate exported as **`inject({ … })`** over shared **`*Dependencies`** maps; **`transportShortcuts.spec.ts`**, **`trackShortcuts.spec.ts`**, **`workspaceShortcuts.spec.ts`** (smoke).
- **`Transport/useCases/transportQueries.ts`** — **`getTempoMapState`** = **`inject({ tempoMapStore })`**; return type **`TempoMapStoreState | null`**; **`audioEngine/useCases/offlineRender.ts`** — **`scheduleTrackClips`** `changes` param typed as **`TempoChange[]`** (fixes **`ReturnType<typeof getTempoMapState>`** inference with injectables); **`transportQueries.spec.ts`** extended.
- **`Transport/useCases/loopStation/createSlot.ts`** — **`inject({ loopStationStore })`**; **`createSlot.spec.ts`** (smoke).
- **`Transport/useCases/loopStation/clearSlot.ts`** — **`inject({ loopStationStore })`**; **`clearSlot.spec.ts`** (smoke).
- **`Transport/useCases/loopStation/`** — **`toggleRecord`**, **`toggleArm`**, **`stopSlot`**, **`triggerScene`**, **`undoLastLayer`**, **`stopAllSlots`**, **`toggleSync`**, **`setFixedLoopLength`**, **`createSlot`**, **`clearSlot`** — **`inject({ loopStationStore })`**; smoke tests in matching **`*.spec.ts`** per file.
- **`Transport/useCases/setlist/`** — **`goToItem`** **`inject({ eventBus, setlistStore })`**; **`nextItem`** / **`previousItem`** **`inject({ setlistStore, goToItem })`**; **`addSetlistItem`** **`inject({ setlistStore, getNextSetlistItemId, SETLIST_ITEM_COLORS })`**; remaining setlist mutators/queries **`inject({ setlistStore })`**; smoke tests in matching **`*.spec.ts`** per file (e.g. **`goToItem.spec.ts`**, **`nextItem.spec.ts`**).
- **`Transport/useCases/punchRecording/`** — **`togglePunchRecording`**, **`setPreRoll`**, **`setPostRoll`**, **`stopBackgroundCapture`**, **`discardCapture`**, **`commitPunchRegion`**, **`updateCapturePosition`** — **`inject({ punchRecordingStore })`**; **`startBackgroundCapture`** **`inject({ punchRecordingStore, getNextCaptureId })`**; **`definePunchRegion`** **`inject({ punchRecordingStore, getNextPunchId })`**; smoke tests in matching **`*.spec.ts`** per file.
- **`Extension/useCases/extension/`** — store-backed helpers **`inject({ extensionStore })`**; **`executeCommand`** **`inject({ extensionStore, appendLog })`**; **`runEditorScript`** **`inject({ extensionStore, appendLog, createDawApi })`**; smoke tests in matching **`*.spec.ts`** per file.
- **`AudioEngine/useCases/offlineRender.ts`** — **`renderOffline`** / **`exportStems`** = **`inject({ getTrackStoreState, getMidiStoreState, getTransportStoreValue, getTempoMapState, getAutomationLanes, audioBufferCache, buildDeviceChain, resolveClipsWithComping, beatToSeconds, resolveDrumKit, scheduleTrackAutomation, scheduleNoteOffline, getSynthParamsFromDevices, scheduleKitNote, getDrumKitDefByIndex, scheduleDrumKitNote })`**; **`createOfflineTrackStrip`** / **`scheduleTrackClips`** take **`deps`** first; **`offlineRender.spec.ts`** (smoke).
- **`Arrangement/useCases/resolveComping.ts`** — **`resolveClipsWithComping`** = **`inject({ takeLaneStore })`**; **`resolveComping.spec.ts`** (smoke).
- **`Synth/useCases/builtinSynth.ts`** — **`getSynthParamsForTrack`** = **`inject({ getTrackById })`**; **`scheduleNote`**, **`getSynthParamsFromDevices`**, **`scheduleNoteOffline`** unchanged (pure / device snapshot); **`builtinSynth.spec.ts`** (smoke).
- **`Arrangement/useCases/comping/setCompRegion.ts`** — **`inject({ takeLaneStore })`**; **`setCompRegion.spec.ts`** (smoke).
- **`Arrangement/useCases/comping/addTake.ts`** — **`inject({ takeLaneStore })`**; **`addTake.spec.ts`** (smoke).
- **`Arrangement/useCases/comping/getTakeLaneForTrack.ts`**, **`addTakeLane.ts`**, **`selectTake.ts`**, **`flattenComp.ts`** — **`inject({ takeLaneStore })`**; matching **`*.spec.ts`** (smoke).
- **`Synth/useCases/faustInstrumentScheduler.ts`** — **`scheduleFaustNote`** = **`inject({ scheduleDeviceParam })`**; **`startFaustNote`** = **`inject({ scheduleDeviceParam, getCurrentTime })`**; **`faustInstrumentScheduler.spec.ts`** (smoke).
- **`Project/useCases/projectPersistence/helpers.ts`** — **`clearUndoHistory`** = **`inject({ undoStore })`**; **`resetModuleStoresToDefault`** / **`hydrateModuleStoresFromProjectData`** share **`moduleStoreResetDependencies`** (track/transport/automation/MIDI/tempo/time-sig/marker/take-lane stores, **`setSidechainRoutes`**, **`defaultTransportState`**); **`verifyAudioBufferReferences`** = **`inject({ trackStore, audioBufferCache, notifyUser })`**; **`helpers.spec.ts`** (smoke).
- **`Project/useCases/demoProjects/demoUtils.ts`** — **`applyPreset`** = **`inject({ getFactoryPresets })`**; **`generateDemoDrumBuffer`** = **`inject({ audioBufferCache })`**; **`syncArrangement`** = **`inject(demoSyncArrangementDependencies)`** (arrangement store, **`defaultArrangementId`**, automation/MIDI/marker stores); **`note`**, **`createAudioClip`**, **`createMidiClip`**, **`createNoiseBurst`** remain plain helpers; **`demoUtils.spec.ts`** (smoke for **`applyPreset`** + **`syncArrangement`**).
- **`Arrangement/useCases/getTrackStoreState.ts`** — **`inject({ trackStore })`**; re-exports **`TrackStoreState`** from **`trackStore`**; **`offlineRender`** uses **`Track`** for track rows (injectables break **`ReturnType<typeof getTrackStoreState>`** inference); **`getTrackStoreState.spec.ts`** (smoke).
- **`Arrangement/useCases/scratchPad/scratchPadCrud.ts`** — **`addScratchPadSection`**, **`removeScratchPadSection`**, **`renameScratchPadSection`**, **`setScratchPadSectionColor`**, **`clearScratchPad`**, **`reorderScratchPadSection`** = **`inject({ scratchPadStore })`**; **`scratchPadCrud.spec.ts`** (smoke).
- **`Arrangement/useCases/buildTimelineRenderModel.ts`** — **`inject(buildTimelineRenderModelDependencies)`** (track/transport/timeline-view/MIDI/workspace/prefs stores, **`playheadPositionRef`**, **`clipDragPreviewRef`**, **`activeRecordingRef`**, **`TRACK_HEIGHT_VALUES`**, **`getViewportWidth`**); module cache unchanged; **`buildTimelineRenderModel.spec.ts`** (smoke).
- **`Arrangement/useCases/groupComping/compGroupOperations.ts`** — **`compGroupOperationsDependencies`** (**`groupCompingStore`**, **`getNextGroupId`**, **`getNextTakeSetId`**, **`getNextRegionId`**, **`GROUP_COLORS`**) on **`createCompGroup`**, **`addGroupTakeSet`**, **`swipeGroupComp`**, **`setActiveGroupTakeSet`**, **`deleteCompGroup`**; **`compGroupOperations.spec.ts`** (smoke **`createCompGroup`**).
- **`Arrangement/useCases/timelineInteractions/hitTestClip.ts`** — **`hitTestClipDependencies`** (**`timelineViewStore`**, **`buildTimelineRenderModel`**, **`getTrackAtY`**) on **`hitTestClip`** / **`hitTestTrack`**; **`hitTestClip.spec.ts`** (smoke).
- **`Arrangement/useCases/timelineInteractions/hitTestClipEdge.ts`** — **`hitTestClipEdgeDependencies`** (same seam as **`hitTestClip`**); **`hitTestClipEdge.spec.ts`** (smoke left/right/body + null view).
- **`Arrangement/useCases/initTimelineRenderer.ts`** — **`initTimelineRendererDependencies`** (**`getPreferredRendererBackend`**, **`createWebGpuRenderer`**, **`createCanvasRenderer`**); **`initTimelineRenderer.spec.ts`** (smoke canvas / webgpu / fallback).
- **`Arrangement/useCases/timelineInteractions/beginClipDrag.ts`** — **`beginClipDragDependencies`** (**`hitTestClip`**, **`timelineViewStore`**, **`trackStore`**); **`beginClipDrag.spec.ts`** (smoke).
- **`Arrangement/useCases/timelineInteractions/snapToGridOrClips.ts`** — **`snapToGridOrClipsDependencies`** (**`trackStore`**, **`snapToGrid`**); **`snapToGridOrClips.spec.ts`** (smoke).
- **`Arrangement/useCases/timelineInteractions/hitTestAutomationSubLane.ts`** — **`hitTestAutomationSubLaneDependencies`** (view/track/workspace/automation stores + **`buildTimelineRenderModel`**); **`hitTestAutomationSubLane.spec.ts`** (smoke hit + hidden).
- **`Arrangement/useCases/scratchPad/captureCommit.ts`** — **`captureCommitDependencies`** (**`scratchPadStore`**, **`markerStore`**) on **`captureArrangementToScratchPad`** / **`commitScratchPadToArrangement`**; **`captureCommit.spec.ts`** (smoke).
- **`Arrangement/useCases/timelineQueries.ts`** — **`getMarkerState`** = **`inject({ markerStore })`**; **`timelineQueries.spec.ts`** (smoke); **`selectionHelpers`** unchanged (injects **`getMarkerState`** as collaborator).
- **`Arrangement/useCases/clipboard/copySelectedNotes.ts`** — **`copySelectedNotesDependencies`** (**`midiStore`**, **`setNoteClipboard`**); **`copySelectedNotes.spec.ts`** (smoke).
- **`Arrangement/useCases/setTrackStoreState.ts`** — **`inject({ trackStore })`**; **`setTrackStoreState.spec.ts`** (smoke); **`trackAlternativeHandlers`** / **`createGrandBouleTrack`** / **`createDrumTrackStack`** still inject **`setTrackStoreState`** as collaborator.
- **`Arrangement/useCases/vca/getVcaGroups.ts`** — **`inject({ getVcaGroupsState })`**; **`getVcaGroups.spec.ts`** (smoke).
- **`Arrangement/useCases/vca/setVcaGain.ts`** — **`setVcaGainDependencies`** (**`getVcaGroupsState`**, **`setVcaGroupsState`**); **`setVcaGain.spec.ts`** (smoke).
- **`Arrangement/useCases/clipGainEnvelope/*`** — **`getClipGainEnvelope`** = **`inject({ gainEnvelopeStore })`**; **`resetClipGainEnvelope`**, **`getGainAtBeat`**, **`moveGainEnvelopePoint`**, **`removeGainEnvelopePoint`**, **`getAllClipGainEnvelopes`** = same single-map seam; **`toggleClipGainEnvelope`** (**`toggleClipGainEnvelopeDeps`**: **`getClipGainEnvelope`**, **`gainEnvelopeStore`**); **`addGainEnvelopePoint`** (**`addGainEnvelopePointDeps`**: same); matching **`*.spec.ts`** per file (smoke); **`scheduleAudioClips`** still injects **`getGainAtBeat`**.
- **`Arrangement/useCases/adjustmentLayer/getLayerCount.ts`** — **`inject({ adjustmentLayerStore })`**; **`getLayerCount.spec.ts`** (smoke).

### Migration policy (repo-wide)

**Target:** Every **`useCases/**/*.ts`** file that **orchestrates** collaborators (calls other modules’ use cases, engine facades, or cross-module I/O) must use **`inject({ … })(factory)`** (or documented constructor-injection for classes such as **`AutomergeSync`**) and ship a **smoke `*.spec.ts`** beside the implementation file so **`injectDependencies()`** can substitute collaborators. **Name the spec after the implementation:** **`foo.spec.ts`** tests **`foo.ts`** (no umbrella **`fooBarUseCases.spec.ts`** files for unrelated modules).

**Dependency map shape (this audit):**

| Situation | Pattern |
|-----------|---------|
| **Single collaborator** | Inline **`inject({ depName })(...)`**. Do **not** introduce a named export like **`fooDependencies`** or a **`const`** whose only job is to hold one key. |
| **Multiple collaborators** | A named map (e.g. **`export const fooDependencies = { … }`**) is fine when the same map is reused or the file is easier to read that way. **Do not** add **`as const`** on that object unless you have a concrete typing need (default: omit it). |

**Inventory vs violations:** Grepping for files **without** `inject(` still yields **hundreds** of paths — that is **not** the same as hundreds of missing migrations. Typical **exempt** categories (no **`inject()`** required unless you want a test seam): **pure** functions (**`evaluateFollowActions`**, math), **single-store** CRUD with no cross-module calls, **static presets/data** (e.g. **`Toaster/useCases/toasterQueries.ts`** — preset list re-exports only), **type/barrel helpers**, and **algorithms** that only import models.

**Remaining queue (orchestrators):** **Arrangement** — any remaining **`useCases`** that orchestrate without **`inject`** (e.g. deeper timeline drag/commit helpers); **`getTrackAtY`** stays a **pure** helper — migrate **in batches** with **`pnpm typecheck`** and targeted **`pnpm exec vitest run …`**. (**Demo projects:** §F — not queued; **`beginClipDrag`**, **`snapToGridOrClips`**, **`hitTestAutomationSubLane`** — see **Resolved**.) Discover candidates:

`find src/modules -path '*/useCases/*' -name '*.ts' ! -name '*.spec.ts' -print | while read f; do grep -q 'inject(' "$f" || echo "$f"; done`

Pure store/math helpers and **type-only** imports may stay plain per **`docs/architecture/03-typescript-module.md`** §4.10; when in doubt, add **`inject()`** so tests stay free of **`vi.mock`** on whole modules.

---

## Verification commands (when working issues)

- `pnpm typecheck`
- `pnpm test:run`
- After cross-module import churn: `pnpm deps:validate` (per `AGENTS.md`)

---

## Coverage backfill — orphan use case / repository tracking (2026-04 pass)

**Goal:** Every `useCases/**/*.ts` and `repositories/**/*.ts` should have either (a) a sibling `*.spec.ts` smoke test or (b) a documented exemption (pure helper, single-store CRUD with no orchestration, static data, type re-export).

**Total orphans found at start of pass:** 460 useCases, 94 repositories across 31 modules.

**Per-module orphan inventory at session start:**

| Module | useCases orphans |
|---|---|
| Arrangement | 93 |
| AudioEngine | 72 |
| MIDI | 48 |
| Plugin | 34 |
| Automation | 27 |
| Yeast | 23 |
| CrdtDocument | 19 |
| Project | 17 |
| GrandBoule | 17 |
| SoundLibrary | 15 |
| Command | 13 |
| AiRuntime | 11 |
| AiGeneration | 10 |
| Sampler | 9 |
| AudioAnalysis | 8 |
| Toaster | 6 |
| Transport | 5 |
| Synth | 5 |
| SampleLibrary | 4 |
| Workspace | 3 |
| Routing | 3 |
| Fermenter | 3 |
| Collaboration | 3 |
| Scoring | 2 |
| Levain | 2 |
| Gluten | 2 |
| Crust | 2 |
| Proof | 1 |
| Knead | 1 |
| Grinder | 1 |
| Bacteria | 1 |

### Progress log

| Date | Module | Files added | Files exempted | Notes |
|---|---|---|---|---|
| 2026-04-10 | Bacteria | 1 | 0 | Preset schema test. |
| 2026-04-10 | Grinder | 1 | 0 | Preset schema test. |
| 2026-04-10 | Proof | 1 | 0 | Preset schema test. |
| 2026-04-10 | Knead | 1 | 0 | DSP pitch parser smoke test. |
| 2026-04-10 | Crust | 2 | 0 | Presets + paramBridge (rAF stub + `injectDependencies`). |
| 2026-04-10 | Gluten | 2 | 0 | Presets + paramBridge. |
| 2026-04-10 | Levain | 2 | 0 | `loadPreset` + `autoLoadSamples` (Tauri mocks). |
| 2026-04-10 | Scoring | 2 | 0 | Single-store CRUD smoke tests. |
| 2026-04-10 | Collaboration | 3 | 0 | `getCollaborationHandlers` factory + `PermissionManager` + `AssetTransfer`. |
| 2026-04-10 | Fermenter | 3 | 0 | `fermenterQueries`, `presetMorph` (lerp/bilinear math), `setFermenterMappedParam` warn-on-unknown. |
| 2026-04-10 | Routing | 3 | 0 | `sidechain` (cycle detection, idempotent add, set/replace), `busControls`, `hydrateSidechainRoutes`. |
| 2026-04-10 | Workspace | 3 | 0 | `getWorkspaceHandlers`, `getScratchPadHandlers`, `setTrackHeight`. |
| 2026-04-10 | SampleLibrary | 4 | 0 | `buildFolderTree` (tree assembly), `connectFolder` (cancel/rescan smoke), `requestPermission` / `restoreLibrary` (delegate smoke). |
| 2026-04-10 | Synth | 5 | 0 | `cvConversion` (1V/oct + Hz/V + clock), `cvOutputOperations` (CRUD + clamping), `proSynthInstruments` (registers 4 Faust DSPs), `drumKitSynth`, `kitDefinitions`. |
| 2026-04-10 | Transport | 5 | 0 | `evaluateFollowActions` (stop / play_next / play_first branches), `tempoMap`, `timeSignatureChanges`, `getTransportHandlers`, `ensureTrackStrips` (`injectDependencies` over engine seam). |
| 2026-04-10 | Toaster | 6 | 0 | `euclidean` (Bjorklund + rotation), `applyEuclidean`, `setMorphPosition`, `soundLocks`, `patternMorph`, `toasterQueries`. |
