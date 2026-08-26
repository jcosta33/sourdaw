# Project module — Agent Guidelines

Root Project aggregate lifecycle, project persistence (IndexedDB and native filesystem), starter templates, musical scale/tuning configuration, missing media resolution, and semantic AI queries (CRDT synchronization belongs to CrdtDocument; version snapshots belong to ProjectVersioning).

## Public Contract Surface

- `stores`:
    - `projectStore` (`ProjectStoreState`, `defaultProjectStoreState`)
    - `arrangementStore` (`ArrangementStoreState`, `defaultArrangementId`)
    - `missingMediaStore` (`MissingMediaStoreState`, `defaultMissingMediaStoreState`, `MissingMediaItem`, `MissingMediaKind`)
    - `projectLoadFailureStore` (`ProjectLoadFailureState`)
- `useCases`:
    - **Lifecycle & Persistence**: `newProject`, `saveProject`, `loadProject`, `renameProject`, `markDirty`, `initProjectDirtyTracking`, `initGrooveTemplateDirtyTracking`, `migrateLegacyProjectSnapshots`, `captureProjectTransitionAuthority`, `setProjectIdentityTransitionDependencies`, `finishProjectLoading`.
    - **Templates & Previews**: `createFromTemplate`, `getTemplates`, `getPreviewLoop`.
    - **Tuning & Scales**: `importSclFile`, `setProjectKeyRoot`, `setProjectScaleName`.
    - **Media & Files**: `pickFiles`, `verifyAudioBufferReferences`, `exportProjectFile`, `pickAndImportProjectFile`.
    - **Interchange Contracts**: `buildProjectData`, `applyImportedProjectData`, `runProjectLoadTransaction`, `isNativeProjectRuntimeAvailable`.
    - **Semantic Queries & Briefs**: `doesProductionBriefAllowActionBatch`, `productionBriefActionBatchAdmission`, `acceptCreativeIntent`, `querySemanticProject`, `getProjectProtocolContracts`, `getAgentProjectModelContract`, `getDurableProjectOwnerId`.
    - **Recent Projects**: `getRecentProjects`, `loadRecentProject`.
    - **Handlers**: `getProjectHandlers`.
- `presentations/views`: `ArrangementSelector`, `MissingMediaPanel`, `RecentProjectsMenu`.
- Handlers: `getProjectHandlers` (`createProjectFromTemplate`, `setProductionBrief`).

## Key Subsystems

- **Project Persistence**: Orchestrates saving, loading, dirty state tracking, and legacy migration across IndexedDB and native desktop files (`useCases/projectPersistence/`).
- **Native Project Files**: Tauri IPC bridge for direct desktop disk I/O (`repositories/nativeProjectFiles/`: `saveProjectToFile`, `loadProjectFromFile`, `listProjectFiles`).
- **Template Engine**: Factory templates and starter arrangements with audio preview loops (`useCases/projectTemplates/`).
- **Missing Media Detector**: `stores/missingMediaStore.ts` and `useCases/projectPersistence/helpers/verifyAudioBufferReferences.ts` inspect audio buffer references against loaded clips to flag missing assets.
- **Semantic Project Query Engine**: Structured read interface and creative brief validation for automated agents and AI workflows (`useCases/semanticProjectQueries.ts`, `models/ProductionBrief.ts`).
- **Scala Tuning Parser**: Parses microtonal `.scl` scale files into project pitch definitions (`repositories/nativeTuning/parseScl.ts`).

## Invariants & Traps

- **Single Active Project**: Only one project aggregate is active in memory at a time; project transitions must teardown prior audio graphs and reset dirty states.
- **Dirty Tracking Lifecycle**: Any mutation affecting project state must invoke `markDirty` to ensure unsaved work prompts on unload or autosave.
- **Runtime Detection**: Always check `isNativeProjectRuntimeAvailable` / `isNativeFileSystemAvailable` before issuing native desktop filesystem commands.
- **Scala Tuning Validation**: `.scl` parsing enforces valid pitch ratios/cents and line formats, rejecting corrupted tuning files.

## Verification

```bash
pnpm vitest run src/modules/Project
```
