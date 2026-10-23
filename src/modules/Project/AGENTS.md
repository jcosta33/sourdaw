# Project module — Agent Guidelines

Root Project aggregate lifecycle, project persistence (IndexedDB and native filesystem), starter templates, musical scale/tuning configuration, missing media resolution, and semantic AI queries (CRDT synchronization belongs to CrdtDocument; version snapshots belong to ProjectVersioning).

## Public Contract Surface

- `stores`:
    - `projectStore` (`ProjectStoreState`, `defaultProjectStoreState`)
    - `arrangementStore` (`ArrangementStoreState`, `defaultArrangementId`)
    - `missingMediaStore` (`MissingMediaStoreState`, `defaultMissingMediaStoreState`, `MissingMediaItem`, `MissingMediaKind`)
    - `projectLoadFailureStore` (`ProjectLoadFailureState`)
- `useCases`:
    - **Lifecycle & Persistence**: `newProject`, `saveProject`, `loadProject`, `renameProject`, `markDirty`, `initProjectDirtyTracking`, `initGrooveTemplateDirtyTracking`, `captureProjectTransitionAuthority`, `setProjectIdentityTransitionDependencies`, `finishProjectLoading`.
    - **Templates & Previews**: `createFromTemplate`, `getTemplates`, `getPreviewLoop`.
    - **Tuning & Scales**: `importSclFile`, `setProjectKeyRoot`, `setProjectScaleName`.
    - **Media & Files**: `pickFiles`, `verifyAudioBufferReferences`, `exportProjectFile`, `pickAndImportProjectFile`.
    - **Interchange Contracts**: `buildProjectData`, `applyImportedProjectData`, `runProjectLoadTransaction`, `isNativeProjectRuntimeAvailable`.
    - **Semantic Queries & Briefs**: `doesProductionBriefAllowActionBatch`, `productionBriefActionBatchAdmission`, `collectProtectedScopes`, `isProjectWideScope`, `getProjectScopedBriefLock`, `acceptCreativeIntent`, `querySemanticProject`, `queryAgentDiscovery`, `parseSemanticProjectQueryInput`, `parseAgentDiscoveryInput`, `agentCapabilityDiscoveryPort`, `getProjectProtocolContracts`, `getAgentProjectModelContract`, `getDurableProjectOwnerId`.
    - **Agent Asset File Boundary**: `agentAssetFileBoundary` (`pickAndRegister`, `importAsset`, `stageExport`, `finalizeExport`, `cleanup`) — the only handle-only surface that may drive the native agent asset saga; `pickAndRegister` mints read handles through the native open dialog and read-write handles through the native save dialog, because only the save channel grants write access.
    - **Recent Projects**: `getRecentProjects`, `loadRecentProject`.
    - **Handlers**: `getProjectHandlers`.
- `presentations/views`: `ArrangementSelector`, `MissingMediaPanel`, `RecentProjectsMenu`.
- Handlers: `getProjectHandlers` (`createProjectFromTemplate`, `setProductionBrief`).

## Key Subsystems

- **Project Persistence**: Orchestrates saving, loading, dirty state tracking, and legacy migration across IndexedDB and native desktop files (`useCases/projectPersistence/`).
- **Native Project Files**: Tauri IPC bridge for direct desktop disk I/O (`repositories/nativeProjectFiles/`: `saveProjectToFile`).
- **Template Engine**: Factory templates and starter arrangements with audio preview loops (`useCases/projectTemplates/`).
- **Missing Media Detector**: `stores/missingMediaStore.ts` and `useCases/projectPersistence/helpers/verifyAudioBufferReferences.ts` inspect audio buffer references against loaded clips to flag missing assets.
- **Semantic Project Query Engine**: Structured read interface and creative brief validation for automated agents and AI workflows (`useCases/semanticProjectQueries.ts`, `models/ProductionBrief.ts`).
- **Owner Catalog Discovery**: `useCases/queryAgentDiscovery.ts` answers device, preset, sample, asset and capability discovery as bounded, revision-bearing receipts built only from records other owners publish — their stable ids, versions, evidence and `unavailable` verdicts copied rather than restated. A query this layer cannot answer is `unsupported`; a catalog that exists but holds nothing to read is `unavailable`, and the two never collapse. Capability entries reach it through `agentCapabilityDiscoveryPort`, which the composition root fills from AiRuntime because AiRuntime imports this module and the reverse import would close a cycle.
- **Scala Tuning Parser**: Parses microtonal `.scl` scale files into project pitch definitions (`repositories/nativeTuning/parseScl.ts`).

## Invariants & Traps

- **Single Active Project**: Only one project aggregate is active in memory at a time; project transitions must teardown prior audio graphs and reset dirty states.
- **Transport Quiesced At The Switch**: every project replacement (`newProject`, `createFromTemplate`, `replaceProjectData`) stops the transport before it tears the old project down, but a Play or Record can land during any later `await`, so the check that matters runs inside `resetCrdtProject`, after its last `await` and in the same synchronous turn as the authority switch. `resetCrdtProjectWithTransportStopped` hands it a check built on `isTransportIdle` (CrdtDocument cannot import Transport without closing a dependency cycle), which also reads busy while a take is still closing and while a take has closed that the helper has not yet saved. A busy transport makes the reset withdraw its durable record and answer `transport-active` without replacing anything; the helper stops playback (awaiting every closing take), saves the outgoing project, tears the audio graph and the external plugins down again and asks again unless the caller's transaction has been superseded meanwhile. Resetting `transportStore` alone would leave the scheduler and engine rolling the old project under a store that reads stopped. A user's Pause or Stop turns the transport idle at once and commits the take afterwards, so idle alone never proves that no take is landing. The repair route obeys the same law at its own boundary: `repairProjectData` stops playback and lands the take's commit before it dispatches, and the handler refuses a transport that is not idle when it executes, because the re-projection releases a take's pending close.
- **A Take That Closes During A Replacement Is Saved Or Reported**: autosave is stopped before the reset, so a take that a stop commits into the outgoing project exists only in memory and the switch is about to replace the document holding it. Each replacement creates a `watchClosedTakes` watch before its first stop and hands it to the helper, which runs `saveProject` (the Save command's path, so the take's audio is made durable with it) whenever a take commit has settled since the watch began or was last saved, and tells the user with `notifyUser` that the take was discarded when that save fails; the replacement still proceeds, because the user asked to leave. A Play or Record in that window also rebuilds the outgoing track strips and wakes its dormant plugins through `ensureTrackStrips`, so every lap of the helper's loop repeats the caller's `resetAudioGraph` and `unloadPlugin`. A Play that is stopped again before the reset asks (Play then Pause inside the unload) leaves the transport idle and is not seen by the check; the strips it rebuilt stay resident.
- **Dirty Tracking Lifecycle**: Any mutation affecting project state must invoke `markDirty` to ensure unsaved work prompts on unload or autosave.
- **Runtime Detection**: Always check `isNativeProjectRuntimeAvailable` / `isNativeFileSystemAvailable` before issuing native desktop filesystem commands.
- **Scala Tuning Validation**: `.scl` parsing enforces valid pitch ratios/cents and line formats, rejecting corrupted tuning files.
- **One Protected-Scope Source**: `collectProtectedScopes` is the only place that decides which brief entries protect anything, and `isProjectWideScope` the only place that decides what "the whole project" means. Batch admission and `getProjectScopedBriefLock` both read them, so a surface that explains a refusal can never name a lock the guard does not enforce.

## Verification

```bash
pnpm vitest run src/modules/Project
```
