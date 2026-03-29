# Dead Code Audit — 2026-03-28

Produced by running `pnpm knip` against the current codebase with a cleaned-up `knip.json` config, then investigating every finding to determine root cause and recommended action.

## Summary

| Category                               | Unused Files | Unused Exports | Unused Types | Other                 |
| -------------------------------------- | ------------ | -------------- | ------------ | --------------------- |
| Replaced / superseded                  | 12           | 14             | 0            | —                     |
| Truly dead                             | 5            | 13             | 3            | —                     |
| Architecture violations (barrel files) | 5            | 0              | 0            | —                     |
| Self-contained feature islands         | 44           | 0              | 0            | —                     |
| Future feature stubs (no UI yet)       | 17           | ~155           | 0            | —                     |
| Missing connections                    | 1            | 12             | 0            | —                     |
| Knip false positives                   | 1            | 2              | 0            | —                     |
| Shadcn library surface                 | 0            | 5              | 0            | —                     |
| Intentionally excluded legacy          | 0            | 0              | 0            | 11 unresolved imports |
| Duplicate exports                      | —            | —              | —            | 5 pairs               |
| Unlisted binaries                      | —            | —              | —            | 1 (`wasm-pack`)       |
| Public API types (keep)                | —            | —              | 5            | —                     |

**Totals:** 95 unused files, 229 unused exports, 8 unused types, 11 unresolved imports, 5 duplicate export pairs, 1 unlisted binary.

---

## 1. REPLACED / SUPERSEDED — Delete

These have active replacements in the codebase. Safe to delete immediately.

### Files

| File                                                                     | Replaced by                                                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/Styles/merge.ts`                                            | `cn.ts` in same directory (uses `clsx` + `tailwind-merge`)                                                                  |
| `src/modules/Arrangement/presentations/views/TrackAutomationHeader.tsx`  | `AutomationLaneHeader.tsx` in the `AutomationView` system                                                                   |
| `src/modules/Arrangement/useCases/contracts.ts`                          | `trackQueries/index.ts` (also a barrel file violation)                                                                      |
| `src/modules/Workspace/.../Inspector/layouts/effects/` (15 files)        | `layouts/effects.ts` (the file). `layouts/index.ts` imports `./effects` which resolves to the `.ts` file, not the directory |
| `src/modules/Workspace/.../metering/CompressorGainReduction.tsx`         | Only consumer was the dead `effects/CompressorLayout.tsx`                                                                   |
| `src/modules/Levain/presentations/components/ArticulationIndicator.tsx`  | Inline badge in rewritten flat `LevainPanel`                                                                                |
| `src/modules/Levain/presentations/components/InstrumentSelector.tsx`     | Inline dropdown in rewritten flat `LevainPanel`                                                                             |
| `src/modules/Levain/presentations/components/LevainPresetBrowser.tsx`    | Sidebar-based `InstrumentsTab` preset browser                                                                               |
| `src/modules/Levain/presentations/components/PerformancePanel.tsx`       | Progressive disclosure UI abandoned; no engine backing                                                                      |
| `src/modules/Toaster/presentations/components/PadInspector.tsx`          | Inline controls in `ToasterPanel` vertical layout                                                                           |
| `src/modules/Toaster/presentations/components/SequencerToolbar.tsx`      | Euclidean generator inlined into `ToasterPanel` top bar                                                                     |
| `src/modules/Workspace/presentations/components/BitcrusherStaircase.tsx` | Only consumer was the dead `effects/BitcrusherLayout.tsx`                                                                   |

### Exports

| Export                                           | File                                       | Replaced by                                            |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| `initLlamaServer`                                | `AiRuntime/.../lifecycle.ts`               | `initNativeEngine` (same file, alias)                  |
| `stopLlamaServer`                                | same                                       | `stopNativeEngine`                                     |
| `isAudioAiServerRunning`                         | `AudioAnalysis/.../audioAiEngine.ts`       | `isAudioGenerationAvailable()`                         |
| `getAvailableMidiInputs`                         | `AudioEngine/.../webMidi/lifecycle.ts`     | Store subscribe pattern in `MidiDevicePicker.tsx`      |
| `getPluginById`                                  | `Arrangement/models/DeviceParameter.ts`    | Inline `BUILTIN_PLUGINS.find()` everywhere             |
| `mapAllTracks`                                   | `Arrangement/.../trackMutations.ts`        | Direct import from `repositories/track`                |
| `engineSetTrackMute`                             | `Arrangement/useCases/trackViewActions.ts` | Direct `setTrackMute` from AudioEngine                 |
| `getMacros`                                      | `Command/.../macro/management.ts`          | Direct `macroStore` read in `MacrosPanel.tsx`          |
| `isRecording` (macro)                            | `Command/.../macro/recording.ts`           | Direct `macroStore.value.recording` read               |
| `getScannedPlugins`, `getScannedPluginsByFormat` | `Plugin/.../pluginScan/queries.ts`         | `pluginScanStore` + `useSyncExternalStore`             |
| `enableLooping`, `toggleLooping`                 | `Transport/useCases/setLooping.ts`         | `toggleLoop` from `transportControls/toggleLoop.ts`    |
| `getTimeSignatureAtBeat`                         | `Transport/useCases/transportQueries.ts`   | Direct model function import in `scheduleMetronome.ts` |
| `PROJECT_STORAGE_KEY`                            | `Project/models/ProjectData.ts`            | Inline `'sourdaw-project'` string                      |
| `isRippleEditing`                                | `Workspace/useCases/rippleEditing.ts`      | Inline `workspaceStore.value?.rippleEditing`           |

---

## 2. TRULY DEAD — Delete

No consumers, no subsystem that needs them, no replacement needed.

### Files

| File                                                  | Reason                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `AudioEngine/engine/ParameterSAB.ts`                  | Only consumer was the dead `HighEndPluginUI.tsx`               |
| `AudioEngine/models/ElasticAudioTypes.ts`             | Only consumer was the dead elastic audio cluster               |
| `AudioEngine/models/SamplePlayerTypes.ts`             | Only consumer was the dead sample player cluster               |
| `AudioEngine/presentations/views/HighEndPluginUI.tsx` | WebGPU plugin GUI shell, never rendered. Has `@ts-nocheck`     |
| `AudioEngine/services/HighEndPluginProcessor.ts`      | AudioWorklet never loaded via `addModule()`. Has `@ts-nocheck` |

### Exports

| Export                             | File                                         | Reason                                                      |
| ---------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `getLessonsByCategory`             | `AiRuntime/.../musicMentor/queries.ts`       | No mentor UI uses filtering                                 |
| `getLessonsByLevel`                | same                                         | No mentor UI uses filtering                                 |
| `gain`                             | `Arrangement/.../presetHelpers.ts`           | All other preset helpers used; this one isn't               |
| `updateClipsOnAllTracks`           | `Arrangement/.../trackMutations.ts`          | Zero callers anywhere                                       |
| `isBrowserStemSeparationAvailable` | `AudioAnalysis/.../browserStemSeparation.ts` | Trivial check, no imports                                   |
| `getFactoryDrumKits`               | `AudioEngine/models/factoryDrumKits.ts`      | Callers use `getDrumKitByIndex`/`getDrumKitById`            |
| `getAudioEngine`                   | `AudioEngine/useCases/engineAccess.ts`       | Superseded by narrower accessors                            |
| `getTemplatesByCategory`           | `Project/.../templateDefinitions.ts`         | `TemplateChooser.tsx` uses `getTemplates()` + inline filter |
| `NOTE_NAMES`                       | `Workspace/.../laneConstants.ts`             | Duplicate of `pianoRollConstants.ts`                        |
| `PROMPT_CATEGORY_KEYS`             | `Workspace/.../usePromptExecution.ts`        | Category UI never built                                     |
| `setGrinderUiLevel`                | `Toaster/stores/toasterStore.ts`             | Progressive disclosure abandoned + stale `Grinder` name     |
| `setGrinderEngineReady`            | `Toaster/stores/toasterStore.ts`             | Never wired to engine init + stale `Grinder` name           |
| `isSequencerPlaying`               | `Toaster/useCases/sequencerPlayback.ts`      | Redundant with `toasterStore.value.isPlaying`               |

### Types

| Type                    | File                                       | Reason                                                                        |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `CodeLocation`          | `helpers/Event/EventLog.ts`                | Convenience alias, zero consumers                                             |
| `AiRuntimeStatus`       | `AiRuntime/models/IntentResult.ts`         | Orphaned — actual status modeled differently in `llmStatusStore`              |
| `BuildDeviceChainInput` | `AudioEngine/useCases/buildDeviceChain.ts` | Describes object-param API that doesn't exist (function uses positional args) |

---

## 3. SELF-CONTAINED FEATURE ISLANDS — Delete

Complete implementations that form isolated dependency islands — they only import each other. No external code reaches into them. Several contain barrel `index.ts` files violating the NO BARREL FILES rule. Can be recreated when the features are actually built.

| Cluster                                             | Files | Notes                                                                                |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `AudioEngine/useCases/elasticAudio/`                | 5     | Barrel `index.ts`. `finalFeatureHandlers` has stubs that call `notifyUser()` instead |
| `AudioEngine/useCases/samplePlayer/`                | 4     | Barrel `index.ts`. Old single-file version was refactored into folder, never wired   |
| `Plugin/repositories/pluginBridge/` (5 unused)      | 5     | Rust backend commands exist; frontend repos ready but no use case calls them         |
| `Plugin/useCases/modulationSystem/` (8 unused)      | 8     | Routing half of modulation — source creation is wired, route management is not       |
| `Plugin/useCases/nodeView/` (8 unused)              | 8     | Graph manipulation — `toggleNodeView` is wired, actual node ops have no canvas UI    |
| `Plugin/useCases/pushIntegration/` (8 unused)       | 8     | Runtime interaction — connect/disconnect wired, pad/encoder has no MIDI I/O bridge   |
| `Arrangement/useCases/adjustmentLayer/` (8 unused)  | 8     | CRUD ops — `createAdjustmentLayer` is wired, rest has no UI                          |
| `Arrangement/useCases/clipGainEnvelope/` (3 unused) | 3     | Envelope query/move — inspector uses 5 siblings, these 3 await a canvas renderer     |
| `Project/useCases/dawProject/`                      | 4     | DAWproject XML import/export — barrel `index.ts`, no File menu action                |
| `Project/models/DawProjectTypes.ts`                 | 1     | Only consumed by the dead dawProject cluster                                         |
| `Command/useCases/undoTree/navigateToNode.ts`       | 1     | Undo tree node navigation — no tree visualization UI                                 |
| `Command/useCases/undoTree/queries.ts`              | 1     | Undo tree stats/queries — no tree visualization UI                                   |

---

## 4. FUTURE FEATURE STUBS — Keep

Complete use-case + store subsystems intentionally scaffolded but with no presentation layer yet. A few exports from each are wired to command handlers (proving intent), but the bulk of the API has no UI consumers.

### Full subsystems (store + use cases, no UI)

| Subsystem                       | Unused exports | Wired exports (via handlers)                                        | Has store?                                                                           |
| ------------------------------- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Transport / Loop Station        | 8              | 2 (`toggleRecord`, `triggerScene`)                                  | Yes                                                                                  |
| Transport / Punch Recording     | 8              | 1 (`togglePunchRecording`)                                          | Yes                                                                                  |
| Transport / Setlist             | 10             | 2 (`nextItem`, `previousItem`)                                      | Yes                                                                                  |
| AudioEngine / Control Room      | 10             | 3 (`toggleMono`, `toggleDim`, `switchMonitor`)                      | Yes                                                                                  |
| AudioEngine / Control Surface   | 10             | 1 (`setProtocol`)                                                   | Yes                                                                                  |
| AudioEngine / RAVE Neural Audio | 9              | 2 (`loadModel`, `setTransferBlend`)                                 | Yes                                                                                  |
| AudioEngine / Audio Warping     | 9              | 3                                                                   | Yes (**possibly duplicated** with `Arrangement/useCases/warp` — needs consolidation) |
| Extension system                | 10             | 2 (`runEditorScript`, `toggleScriptEditor`)                         | Yes                                                                                  |
| SoundLibrary / Sample Database  | 14             | 1 (`searchSamples`)                                                 | Yes                                                                                  |
| Synth / CV/Gate                 | 6              | 1 (`addCvOutput`)                                                   | Yes                                                                                  |
| Project / Version Control       | 8              | 3 (`createProjectVersion`, `restoreVersion`, `createVersionBranch`) | Yes                                                                                  |
| Collaboration (partial)         | 4              | 4 (session mgmt)                                                    | Yes                                                                                  |

### Scattered future-feature exports

| Export(s)                                                                                                      | File                                         | Subsystem                        |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------- |
| `addGroupTakeSet`, `swipeGroupComp`, `setActiveGroupTakeSet`, `deleteCompGroup`                                | `Arrangement/.../compGroupOperations.ts`     | Group comping                    |
| `getNextRegionId`                                                                                              | `Arrangement/stores/adjustmentLayer.ts`      | Adjustment layers                |
| `createAutomationObject`                                                                                       | `Automation/models/Automation.ts`            | Automation objects               |
| `DESTRUCTIVE_ACTIONS`, `REQUIRES_CONFIRMATION`                                                                 | `Command/models/AppAction.ts`                | Confirm-before-execute safety UX |
| `getCurrentPath`, `getForwardPath`, `countBranches`, `getBranchPoints`                                         | `Command/models/UndoTree.ts`                 | Undo tree visualization          |
| `switchBranch`, `isUndoTreeEnabled`                                                                            | `Command/useCases/undoTree/`                 | Undo tree branch navigation      |
| `transposeForChordTrack`                                                                                       | `MIDI/transformers/chordTransposer.ts`       | Chord-aware MIDI                 |
| `getChordAtBeat`                                                                                               | `MIDI/.../getChordAtBeat.ts`                 | Chord track queries              |
| `getPatternInstances`, `propagateParentChanges`                                                                | `MIDI/useCases/patternInstance.ts`           | Linked MIDI clips                |
| `getNextNodeId`, `getNextConnectionId`, `NODE_COLORS`                                                          | `Plugin/stores/nodeView.ts`                  | Node graph editor                |
| `PAD_MODE_COLORS`                                                                                              | `Plugin/stores/push.ts`                      | Push controller                  |
| `getFaustCompilerError`, `isFaustCompilerReady`, `compileAllFaustModules`, `getFaustModules`, `getFaustModule` | `Plugin/.../compilerEngine.ts`               | Faust diagnostics/batch          |
| `createFromPreset`, `getPresetsByCategory`                                                                     | `Plugin/useCases/modulatorLibrary.ts`        | Modulator presets                |
| `closePluginGui`                                                                                               | `Plugin/useCases/pluginLifecycle.ts`         | Native plugin GUI close          |
| `scanCustomPaths`                                                                                              | `Plugin/.../scanning.ts`                     | Custom plugin scan paths         |
| `getRegisteredPlugins`, `getPluginsByCategory`, `loadWAMPlugin`, `unloadWAMPlugin`, `getActiveInstances`       | `Plugin/.../hostOperations.ts`               | WAM plugin host                  |
| `getBarBeatAtPosition`                                                                                         | `Transport/models/TimeSignatureMap.ts`       | Variable meter support           |
| `toggleAutoDetect`, `setNativeF64Support`, `getCurrentPrecision`                                               | `AudioEngine/.../audioPrecision.ts`          | F64 auto-detection               |
| `reportLatency`, `clearReportedLatency`                                                                        | `AudioEngine/.../compensation.ts`            | Plugin latency reporting         |
| `setLinkTempo`, `linkStartPlaying`, `linkStopPlaying`                                                          | `AudioEngine/repositories/linkBridge.ts`     | Ableton Link sync                |
| `startMidiLearnLegacy`, `stopMidiLearnLegacy`, `destroyWebMidi`                                                | `AudioEngine/.../webMidi/lifecycle.ts`       | MIDI learn + teardown            |
| `openFileDialog`, `saveFileDialog`                                                                             | `Project/.../nativeFileDialog.ts`            | Native file dialogs              |
| `listProjectFiles`                                                                                             | `Project/.../nativeProjectFiles.ts`          | Project file browser             |
| `adjustTempoPoint`                                                                                             | `Transport/.../tempoMapping/operations.ts`   | Tempo map editor                 |
| `getTimeSignatureChanges`                                                                                      | `Transport/.../timeSignatureChanges.ts`      | Time signature query             |
| `addScratchPadSection`                                                                                         | `Arrangement/.../scratchPadCrud.ts`          | Scratch pad incremental add      |
| `getPresetsByCategory`                                                                                         | `Arrangement/useCases/soundPresetLibrary.ts` | Preset category filtering        |

### Future-feature files (new modules)

| File                                            | Module  | Notes                                                  |
| ----------------------------------------------- | ------- | ------------------------------------------------------ |
| `Toaster/models/GrooveTemplates.ts`             | Toaster | Valuable groove template data for future swing feature |
| `Toaster/presentations/components/PadMixer.tsx` | Toaster | Standard drum machine pad mixer view                   |
| `Toaster/useCases/noteRepeat.ts`                | Toaster | MPC-style note repeat (hold pad to retrigger)          |
| `Toaster/useCases/patternMorph.ts`              | Toaster | Pattern interpolation (probability-based blending)     |
| `Toaster/useCases/sixteenLevels.ts`             | Toaster | MPC 16 Levels mode                                     |
| `Toaster/useCases/soundLocks.ts`                | Toaster | Elektron Digitakt-style per-step engine overrides      |

### Future-feature exports (new modules)

| Export                     | File                                         | Notes                                |
| -------------------------- | -------------------------------------------- | ------------------------------------ |
| `MACRO_LABELS`             | `Toaster/models/ToasterKit.ts`               | Needed for future macro strip UI     |
| `setFillActive`            | `Toaster/useCases/sequencerPlayback.ts`      | Engine wired, needs UI button        |
| `setToasterKitParam`       | `Toaster/useCases/toasterParamBridge.ts`     | Needed for future kit-level controls |
| `getPresetsByCategory`     | `Levain/repositories/levainPresets.ts`       | Preset category filtering            |
| `getPresetsByLevel`        | `Levain/repositories/levainPresets.ts`       | Preset level filtering               |
| `loadSingleSample`         | `Levain/repositories/sampleLoader.ts`        | Single-sample loading (vs batch)     |
| `setLevainUiLevel`         | `Levain/stores/levainStore.ts`               | Progressive disclosure UI level      |
| `updateEngineMetrics`      | `Levain/stores/levainStore.ts`               | Engine performance metrics           |
| `sendCcToEngine`           | `Levain/useCases/levainParamBridge.ts`       | CC-to-engine forwarding              |
| `loadFactoryPreset`        | `Levain/useCases/loadPreset.ts`              | Factory preset loading               |
| `updateFermenterMetrics`   | `Fermenter/stores/fermenterStore.ts`         | Engine performance metrics           |
| `updateFermenterScope`     | `Fermenter/stores/fermenterStore.ts`         | Oscilloscope data                    |
| `setFermenterEngineReady`  | `Fermenter/stores/fermenterStore.ts`         | Engine readiness flag                |
| `invalidateFermenterCache` | `Fermenter/useCases/fermenterParamBridge.ts` | Device cache invalidation            |

---

## 5. MISSING CONNECTIONS — Should be wired up

These exports have a clear place they should be called but aren't.

| Export                                | File                                         | What's wrong                                                                        |
| ------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `getMentorTip`                        | `AiRuntime/.../musicMentor/queries.ts`       | `newFeatureHandlers.ts` duplicates this logic inline                                |
| `isStemSeparationAvailable`           | `AudioAnalysis/.../audioAiEngine.ts`         | Public gate before stem separation; nothing checks it                               |
| `releaseBrowserStemSession`           | `AudioAnalysis/.../browserStemSeparation.ts` | ONNX session cleanup; never invoked — **model memory stays pinned**                 |
| `getAudioFileInfo`                    | `AudioEngine/.../tauriDecoding.ts`           | Metadata-only probe; useful for file browser but not hooked up                      |
| `getMpeEnabled`                       | `AudioEngine/.../webMidi/lifecycle.ts`       | `setMpeEnabled` is imported; the read accessor is not used in any UI                |
| `isDrawSessionActive`                 | `Automation/.../automationDrawMode.ts`       | Draw session lifecycle wired; this guard predicate is not                           |
| `transformSelectedPoints`             | `Automation/.../automationSelection.ts`      | Selection/delete wired; transform has no gesture calling it                         |
| `resetYZoom`                          | `Automation/.../automationZoom.ts`           | Zoom adjust wired; "reset to full range" is not                                     |
| `updateCursor`, `receiveRemoteAction` | `Collaboration/.../broadcasting.ts`          | **Collab panel exists but sync doesn't work** — these are the missing links         |
| `invalidateToasterCache`              | `Toaster/useCases/toasterParamBridge.ts`     | Should be called on track add/remove/reorder mutations                              |
| `renameMacro`                         | `Command/useCases/macro/management.ts`       | `MacrosPanel.tsx` imports it but `MacrosPanel` itself is not wired into the Sidebar |

### File that should be connected

| File                                    | What's wrong                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Workspace/.../Sidebar/MacrosPanel.tsx` | Fully implemented macro management panel. Valid imports. Just needs to be wired into `Sidebar.tsx` as a tab |

---

## 6. DUPLICATE EXPORTS — Clean up naming migration

| Old name                | New name              | File                                  | Consumers of old                                                 | Action                           |
| ----------------------- | --------------------- | ------------------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| `DAW_CHAT_TOOLS`        | `DAW_TOOL_SCHEMAS`    | `AiRuntime/models/toolDefinitions.ts` | 1 (`inference.ts`)                                               | Remove alias, update 1 callsite  |
| `initLlamaServer`       | `initNativeEngine`    | `AiRuntime/.../lifecycle.ts`          | 0                                                                | Remove alias                     |
| `stopLlamaServer`       | `stopNativeEngine`    | same                                  | 0                                                                | Remove alias                     |
| `isLlamaServerRunning`  | `isNativeEngineReady` | same                                  | 3 (`inference.ts`, `llmMidiGeneration.ts`, `sendChatMessage.ts`) | Migrate 3 consumers, then remove |
| `getTrackState` (alias) | `getTrackStoreState`  | `Arrangement/.../trackStoreAccess.ts` | 5 (services + cross-module)                                      | Migrate 5 consumers, then remove |

---

## 7. UNRESOLVED IMPORTS — Intentionally excluded legacy code

All 11 unresolved imports are in files explicitly excluded from `tsconfig.json`. They are legacy Frontify code that was never ported.

| File                                   | Missing imports                                                        | tsconfig exclude |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `helpers/Event/createEventBus.ts`      | `#/modules/DevTools/...`                                               | Line 47          |
| `helpers/Event/createEventBus.spec.ts` | `#/helpers/Testing/...`                                                | Lines 26–27      |
| `helpers/Logger/createLogger.ts`       | `Configuration`, `DatadogWriter`, `SentryWriter`, `ErrorConsoleWriter` | Line 36          |
| `helpers/Logger/createLogger.spec.ts`  | Same as above                                                          | Lines 26–27      |

**Action:** Add these 4 files to knip's `ignore` list, or delete them if the Frontify logger/event bus are no longer needed.

---

## 8. UNUSED TYPES — Mixed verdicts

### Delete

| Type                    | File                                       | Reason                                                           |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `CodeLocation`          | `helpers/Event/EventLog.ts`                | Convenience alias, zero consumers                                |
| `AiRuntimeStatus`       | `AiRuntime/models/IntentResult.ts`         | Orphaned — actual status modeled differently in `llmStatusStore` |
| `BuildDeviceChainInput` | `AudioEngine/useCases/buildDeviceChain.ts` | Describes object-param API that doesn't exist                    |

### Keep (public API types)

| Type               | File                               | Reason                                                                      |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| `DisabledReason`   | `helpers/platformCapabilities.ts`  | Public API type for platform capability checks                              |
| `WaveformPeak`     | `AudioEngine/.../tauriDecoding.ts` | Domain type documenting waveform peak data shape                            |
| `ActionHandlerMap` | `Command/models/ActionHandler.ts`  | Valuable exhaustiveness type for handler registry                           |
| `MidiEvent`        | `MIDI/models/MidiNote.ts`          | Core domain union, referenced in architecture docs                          |
| `AppEventName`     | `helpers/Event/appEvents.ts`       | Union of all app event names; should be adopted in event handler signatures |

---

## 9. KNIP FALSE POSITIVES

| Item                                                                      | Reason                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `automationSubLanes.ts` (file)                                            | Actively imported by `TrackAutomationHeader.tsx` and `hitTestAutomationSubLane.ts` |
| `getSidechainSource` (export)                                             | Imported in `CompressorLayout.tsx` inside the dead `effects/` directory            |
| `ParamGrid` (export)                                                      | Imported by many effect layouts inside the dead `effects/` directory               |
| `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | Shadcn library surface — `Card` is used, sub-components are standard API           |

---

## 10. UNLISTED BINARY

| Binary      | Source                                                                   | Action                                                                   |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `wasm-pack` | `package.json` scripts (`wasm:fermenter`, `wasm:levain`, `wasm:grinder`) | System-level Rust tool, not an npm package. Add to knip `ignoreBinaries` |

---

## 11. SPECIAL INVESTIGATION: Audio Warping Duplication

`AudioEngine/useCases/audioWarping/` (9 unused exports) appears to **duplicate** `Arrangement/useCases/warp/` which is the implementation the WaveformEditor actually uses. The AudioEngine version has its own `audioWarpStore` separate from the Arrangement warp state. This needs consolidation — either the AudioEngine version is the planned engine-level API (with Arrangement as the UI-facing layer and the two need connecting), or it's a superseded earlier attempt that should be deleted.

---

## Quick-win cleanup summary

| Action                                                    | Count                           | Effort                           |
| --------------------------------------------------------- | ------------------------------- | -------------------------------- |
| Delete truly dead files                                   | ~17 files                       | Trivial                          |
| Delete self-contained islands                             | ~44 files                       | Trivial (no consumers to update) |
| Delete replaced files                                     | ~12 files                       | Trivial                          |
| Remove 14 superseded exports                              | 14 exports across ~12 files     | Small                            |
| Remove 13 truly dead exports                              | 13 exports across ~11 files     | Trivial                          |
| Clean up 5 duplicate export aliases                       | 5 aliases, migrate ~9 consumers | Small                            |
| Remove 3 dead types                                       | 3 types                         | Trivial                          |
| Add 4 legacy files + `wasm-pack` to knip ignore           | Config change                   | Trivial                          |
| Wire up `MacrosPanel` into Sidebar                        | 1 component                     | Small                            |
| Wire up `updateCursor` + `receiveRemoteAction` for collab | 2 callsites                     | Medium                           |
| Fix `releaseBrowserStemSession` memory leak               | 1 callsite                      | Small                            |
| Investigate audio warping duplication                     | 2 subsystems                    | Medium                           |
