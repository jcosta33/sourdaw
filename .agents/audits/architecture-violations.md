# Architecture Violations, Anti-Patterns, and Code Smells

## Scope

Repo-wide audit of `src/modules/**` against the rules in:

- `docs/architecture/03-typescript-module.md`
- `.agents/skills/architecture-violations/SKILL.md`
- `AGENTS.md`

This audit covers structural violations of module boundaries, the one-function-per-file rule, model isolation, type-export discipline, lowercase non-model files in `models/`, fake use cases, and a handful of React/TS smells. It deliberately overlaps with `.agents/audits/handlers-pattern.md` only where the handlers migration has not yet covered a hot spot — see that audit for the canonical handler-migration plan.

## Goal

A codebase where:

1. Every `useCases/<file>.ts` exports exactly one function (per `AGENTS.md` and §4.4 of the architecture doc).
2. No file under `useCases/` re-exports a model, repository, service, validator, transformer, engine, error, or handler symbol. Use case files declare and export their own local typed function only.
3. Module-root `index.ts` re-exports only from `useCases/`, `events/`, `stores/`, `presentations/views/`. Type re-exports are limited to: event payload types, store value types, and (rarely, when unavoidable) local use-case types — never model, repository, service, transformer, validator, engine, or handler types.
4. Cross-module imports always target `#/modules/<Name>` (the root barrel). Intra-module imports always use relative paths.
4b. Transformers, services, validators, repositories, models, and handlers never cross module boundaries — not via direct import, not via launder through `useCases/` or `index.ts`. Modules own their own transformers; if two modules "share" one, the symbol was misclassified.
4c. The presentation layer (`presentations/hooks/`, `presentations/components/`, `presentations/views/`) consumes use cases, stores, and other views — never transformers, services, validators, repositories, models, or handlers, in this module or in any other.
5. Files inside `models/` are PascalCase named after the type they own; lowercase filenames live in `services/`, `transformers/`, `validators/`, or `repositories/` instead.
6. No sub-folder `index.ts` or `contracts.ts` barrels exist apart from each module's root `index.ts`.

## Method

- Static scan via `Glob`/`Grep` over `src/modules/**`.
- Counted exports per file via `^export ` line counts; cross-checked the worst offenders by reading them.
- Verified each "smoking gun" example by hand before listing it.
- Counts under `## Findings` are exact (from the scan); the `## Issues` section uses up to ~10 representative examples per category — see the per-issue note for "approx. total".

---

## Findings

### F1. The "one function per file" rule is broken at scale in `useCases/`

**248** files under `src/modules/**/useCases/` export more than one symbol. The single-function rule is the most violated invariant in the codebase. The worst offenders are not borderline (2–3 exports) — many sit at 10–36 exports and cover unrelated concerns inside one file.

Top offenders by raw export count:

| Exports | File |
| ------- | ---- |
| 36 | `src/modules/Arrangement/useCases/timelineViewActions.ts` |
| 33 | `src/modules/Workspace/useCases/togglePanel/panelToggles.ts` |
| 29 | `src/modules/Workspace/useCases/panels/devicePanels.ts` |
| 23 | `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` |
| 21 | `src/modules/AudioEngine/useCases/engineAccess.ts` |
| 17 | `src/modules/Workspace/useCases/workspaceQueries.ts` |
| 14 | `src/modules/AudioEngine/useCases/finalFeatureHandlers.ts` |
| 13 | `src/modules/Proof/useCases/proofParamBridge.ts` |
| 13 | `src/modules/Command/useCases/commandQueries.ts` |
| 13 | `src/modules/Arrangement/useCases/deviceHandlers.ts` |
| 11 | `src/modules/Levain/useCases/levainParamBridge.ts` |
| 10 | `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts` |
| 10 | `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts` |
| 10 | `src/modules/AudioEngine/useCases/latencyCompensation/compensation.ts` |
| 10 | `src/modules/Arrangement/useCases/batchFeatureHandlers.ts` |
| 9 | `src/modules/AudioEngine/useCases/webMidiInput.ts` |
| 9 | `src/modules/AudioEngine/useCases/audioEngineQueries.ts` |
| 9 | `src/modules/AiRuntime/useCases/dsoEditor/serializeLogicalState.ts` |
| 8 | `src/modules/Toaster/useCases/toasterParamBridge.ts` |
| 8 | `src/modules/Plugin/useCases/wamPluginHost/hostOperations.ts` |
| 8 | `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi.ts` |
| 8 | `src/modules/Command/useCases/selectionHelpers.ts` |
| 8 | `src/modules/AudioEngine/useCases/offlineRender.ts` |
| 8 | `src/modules/Arrangement/useCases/newFeatureHandlers.ts` |

These are the visible spikes. The long tail (2–7 exports) is dominated by `*Queries.ts`, `*Helpers.ts`, `*Actions.ts`, `*Bridge.ts`, and `*Handlers.ts` files. Many of these files are also the carrier for the other violations below: model leakage, repository laundering, multi-responsibility command handlers, and untyped handler maps. Splitting them is a precondition for fixing F2–F5.

### F2. Models and repository symbols are being laundered through `useCases/`

Three use case files re-export model values or model types (the exact pattern the user flagged):

| File | Line | Re-export |
| ---- | ---- | --------- |
| `src/modules/AudioEngine/useCases/engineAccess.ts` | 78 | `export type { SidechainRoute } from '../models/SidechainRoute';` |
| `src/modules/AudioEngine/useCases/engineAccess.ts` | 79 | `export { createSidechainRoute } from '../models/SidechainRoute';` |
| `src/modules/Bacteria/useCases/bacteriaParamBridge.ts` | 341 | `export type { BacteriaPatch } from '../models/BacteriaPatch';` |

A separate set of files in `useCases/` re-exports raw repository symbols, creating fake boundaries (this is the §6.2 "laundering" pattern):

| File | Line | Re-export |
| ---- | ---- | --------- |
| `src/modules/AudioEngine/useCases/engineAccess.ts` | 91 | `export { enableLink, disableLink, getLinkStatus } from '../repositories/linkBridge';` |
| `src/modules/AudioEngine/useCases/offlineRender.ts` | 41–43 | `export { audioBufferToWav/Mp3/Flac } from '../repositories/audioEncoders/...';` |
| `src/modules/AiRuntime/useCases/cloudApiManagement.ts` | 13 | `export { isCloudAvailable } from '../repositories/cloudLlm/keyManagement';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 155 | `export { getActiveModelId } from '../repositories/webLlm/engineLifecycle';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 169 | `export { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 170 | `export { readLevels } from '../repositories/mixAnalysis/readLevels';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 171 | `export { readFrequencyBalance } from '../repositories/mixAnalysis/readFrequencyBalance';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 173 | `export { generateWebLlmCompletion } from '../repositories/webLlm/engineLifecycle';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 174 | `export { generateNativeCompletion } from '../repositories/nativeEngine/completions';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 175 | `export { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';` |

Every line above is a fake boundary: the consumer imports a private repository symbol verbatim under a use-case-shaped path. There is no translation, no validation, no ownership change. `aiRuntimeQueries.ts` is the worst case — it functions as a shadow public surface for the entire `repositories/` tree of `AiRuntime`.

**Transformers laundered through `useCases/` (CRITICAL — transformers must never cross module boundaries):**

| File | Line | Re-export |
| ---- | ---- | --------- |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 172 | `export { detectIssues, generateSuggestions } from '../transformers/mixAnalysisTransformers';` |
| `src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` | 176 | `export { isComplexPrompt } from '../transformers/promptParser/parsing';` |
| `src/modules/AiRuntime/useCases/parsePromptToActions.ts` | 16 | `export { isComplexPrompt } from '../transformers/promptParser/parsing';` (re-exported a *second* time from a different use case) |

`isComplexPrompt` is laundered twice — once via `aiRuntimeQueries.ts` and once via `parsePromptToActions.ts`. Two use cases now both pretend to own a transformer that belongs to neither of them. Per the architecture doc §4.10, transformers are pure, intra-module, and never cross any boundary. The fact that `isComplexPrompt` is being shared across modules at all is the signal that the symbol is misclassified — it is either (a) a thing that belongs in a `services/` file inside the consumer, (b) a thing that should be wrapped in a real use case with a typed signature, or (c) duplicated in each consumer with its own shape.

**Handlers laundered through `useCases/` (must never reach `index.ts` either):**

| File | Line | Re-export |
| ---- | ---- | --------- |
| `src/modules/Arrangement/useCases/clipHandlers.ts` | 1 | `export { clipHandlers } from '../handlers/clip/clipHandlers';` |

`handlers/` is private. A use case file that re-exports from `handlers/` smuggles the handler map onto the module's public surface via the `index.ts` `useCases/` re-export. The handlers-pattern audit (`.agents/audits/handlers-pattern.md`) covers the migration target; this line is one of the legacy back doors that the migration is supposed to close.

**Cross-module presentation layer reaches a transformer through these launders:**

| File | Line | Import |
| ---- | ---- | ------ |
| `src/modules/Workspace/presentations/hooks/usePromptExecution.ts` | 4–17, 378 | `import { isComplexPrompt, … } from '#/modules/AiRuntime'` and uses it inline at line 378 (`const willUseLlm = value.trim().length > 0 && isComplexPrompt(...)`) |

This is the worst end of the chain: a `presentations/hooks/` file in **Workspace** is calling a **transformer** that lives in **AiRuntime**, by way of two layers of laundering (`AiRuntime/transformers/promptParser/parsing` → `AiRuntime/useCases/aiRuntimeQueries.ts` → `AiRuntime/index.ts` → Workspace hook). Three rules are violated in one line:

1. Transformers are private to their module (§4.10).
2. The presentation layer must consume use cases, not transformers, services, validators, or repositories.
3. Cross-module sharing of a transformer is the signal that the symbol was misclassified — `isComplexPrompt` is either a misnamed service, a piece of behaviour that should be wrapped in a real use case, or work that should be duplicated locally in Workspace. Either way it stops being a transformer the moment it crosses a boundary.

### F3. Module `index.ts` files re-export types that should be private

Several modules expose use-case-defined types on their root `index.ts`. Per the updated rule (§4.4 / §6.5 of the skill), this is allowed only for **types declared inside that use-case file** — and even then it is discouraged. In practice the offending modules are doing the more dangerous variant: re-exporting types that originate in `models/` or in another module entirely.

The most problematic cases:

| Module | Line | Export | Why it's wrong |
| ------ | ---- | ------ | -------------- |
| `Yeast/index.ts` | 4 | `export type { MidiEvent, TransportInfo } from './models/MidiEvent';` | Direct re-export from `models/` on the module root. Models are private. |
| `AudioEngine/index.ts` | 82 | `export type { SidechainRoute } from './useCases/engineAccess';` | The type originates in `models/SidechainRoute`; `engineAccess.ts` is a launder. |
| `Routing/index.ts` | 4 | `export type { SidechainRoute } from './useCases/sidechain';` | Same `SidechainRoute` re-exported from a *second* module via a use case that imports it from `#/modules/AudioEngine`. Two modules now share an identity-coupled type. |

The remainder of the cross-module use-case-type exports are local type aliases, but they still violate the discouraged-but-legal carve-out at scale. For `Arrangement` alone:

`Arrangement/index.ts` lines 125, 187, 204, 250, 274, 276, 279 — `ResolvedClip`, `SaveCurrentAsPresetInput`, `ScratchPadSection`, `VCAGroup`, `AutomationShapeType`, `VelocityCurve`, `MarkerStoreState`, `GetFactoryPresetsOutput` all exported as `export type` from `useCases/`. Each one is a candidate for relocation to `events/`, conversion to a `ReturnType<>` derivation in the consumer, or replacement with a local DTO.

Other modules with the same pattern (count of cross-module use-case type exports):

- `AiRuntime/index.ts` — 5 (`MixAnalysisState`, `ModelInfo`, `FuzzyResult`, `MixAnalysis`, `MixIssue`, `ProjectContext*`, `AiChangeNotification`, `AiActionToastMessages`)
- `MIDI/index.ts` — 4 (`ArpPattern`, `ArpRate`, `ChordType`, `GrooveTemplate`, `StrumDirection`)
- `Plugin/index.ts` — 4 (`FaustModule`, `FaustParamDescriptor`, `ModulatorPreset`, `ScannedPlugin`, `WAMDescriptor`, `WAMInstance`)
- `AudioAnalysis/index.ts` — 5 (`AudioFeatures*`, `AudioToMidi*`, `Pitch*`, `PolyphonicAudioToMidi*`, `InsertPolyphonicMidiNotesResult`)
- `AudioEngine/index.ts` — 6 (`AudioDeviceInfo`, `SynthParams`, `MpeParams`, `DrumKit*`, `DeviceNodeEntry`, `BuildDeviceChainOutput`, `MidiGenerationResult`, `MidiGenerationNote`, `DenoiseResult`, `OfflineRenderOptions`, `MidiInputInfo`)
- `Workspace/index.ts` — 2 (`RippleDeletePlan`, `Preferences`/`GridSnapOption`/`WorkspaceState`/`EditingTool`)
- `Transport/index.ts` — 1 (`TransportState`/`TempoChange`/`TimeSignatureChange`)
- `CrdtDocument/index.ts` — 3 (`DocId`/`DocumentBundle`/`MergeResult`, `MutateCrdtDocInput`, `ReplaceCrdtDocInput`)
- `Synth/index.ts` — 1 (`DrumKitVoice`/`DrumKit` — note: AudioEngine also re-exports `DrumKit`/`DrumKitVoice`. Two modules co-own the same identity.)
- `Command/index.ts` — 2 (`ExecuteOptions`, `Macro`)
- `Automation/index.ts` — 1 (`AutomationShapeType` — also re-exported from `Arrangement`. Two modules co-own this identity.)
- `Collaboration/index.ts` — 1 (`CollaborationPeer`/`CollaborationState`/`PresenceData`/`PresenceView`)

Stores types on `index.ts` (legitimate per the new rule, listed for completeness): `ChordTrackState`, `MarkerStoreState`, `ScratchPadStoreState`, `TakeLaneStoreState`, `TimelineViewState`, `TrackStoreState`, `MacroStoreState`, `UndoStoreState`, `ArrangementStoreState`, `ProjectStoreState`, `YeastState`, `AiActionHistoryState`, `LlmEngineStatus`, `VoiceStatus`, `AutomationStoreState`, `MidiStoreState`, `MidiLearnState`, `LinkStatus`, `LibraryState`, `LevainState`, `ExportedAudioBuffer`, `AudioGraphState`, `AudioRecordingState`, `PluginScanState`, `ActionHistoryEntry`, `ActionHistoryState`, `TempoMapStoreState`, `TimeSignatureMapStoreState`, `AiTaskType`/`AiTaskStatus`/`AiTaskResult`/`AiState`. These are fine.

### F4. Lowercase non-model files inside `models/` folders

**52** files under `src/modules/**/models/**` start with a lowercase letter. The convention is: `models/` holds PascalCase files, one per type. Lowercase filenames mean the file is a registry, helper, descriptor list, or pattern bank — none of those are models in the DDD sense. They belong in `services/`, `transformers/`, `validators/`, or in some cases `repositories/`.

Concentration by module:

| Module | Count | Examples |
| ------ | ----- | -------- |
| `AiRuntime/models/` | 24 | `midiPatternLibrary.ts`, `toolDefinitions.ts`, `tools/{clipAndDevice,generationAndView,track,transport,midiAutomationRouting,types}.ts`, `patterns/{bass,chord,drum,melody}Patterns.ts`, `presetActions/{registry,presets/clip,presets/device,presets/midi,presets/track,presets/workspace,presets/transport,presets/generate,presets/types,presets/mixAndAutomation,presets/fileAndCollaboration}.ts` |
| `Arrangement/models/pluginDescriptors/` | 15 | `bacteriaDescriptor.ts`, `samplerDescriptor.ts`, `nativeDspDescriptors.ts`, `levainDescriptor.ts`, `faustEffectDescriptors.ts`, `grinderDescriptor.ts`, `yeastDescriptor.ts`, `fermenterDescriptor.ts`, `builtinInstrumentDescriptors.ts`, `glutenDescriptor.ts`, `builtinEffectDescriptors.ts`, `grandBouleDescriptor.ts`, `proofDescriptor.ts`, `crustDescriptor.ts`, `toasterDescriptor.ts` |
| `Command/models/commands/` | 10 | `aiCommands.ts`, `editCommands.ts`, `projectCommands.ts`, `miscCommands.ts`, `viewCommands.ts`, `trackCommands.ts`, `automationCommands.ts`, `transportCommands.ts`, `midiCommands.ts`, `clipCommands.ts` |
| `Transport/models/` | 3 | `loopStationHelpers.ts`, `setlistItemHelpers.ts`, `punchRecordingHelpers.ts` |
| `AudioEngine/models/` | 1 | `factoryDrumKits.ts` |

Some of these (the descriptor files, the pattern banks, the command lists) are actually data registries — they belong in a `data/` or `services/` folder, not `models/`. The `*Helpers.ts` files in `Transport/models/` are pure functions and belong in `services/` or `transformers/`. `factoryDrumKits.ts` is a fixture and belongs in `repositories/` or alongside the seed data.

### F5. Cross-module deep imports bypass `index.ts`

`14` non-test files import from a foreign module via a deep path (`#/modules/<X>/useCases/...`, `#/modules/<X>/repositories/...`, `#/modules/<X>/models/...`). The clearest hard violations:

| Importer | Imports |
| -------- | ------- |
| `src/modules/Transport/useCases/evaluateFollowActions.ts:1` | `import { type Clip, type Track } from '#/modules/Arrangement/models/Track';` — directly grabs Arrangement's private model types. Textbook model-isolation violation. |
| `src/modules/Collaboration/useCases/getCollaborationHandlers.ts:1` | `import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';` — deep `useCases/` import for type. |
| `src/modules/Arrangement/useCases/presetHandlers.ts` | Same pattern — deep import of `commandQueries` types from Command. |
| `src/modules/AudioEngine/useCases/offlineRender.ts` | Deep imports into Arrangement (alongside its own internal repository re-exports — see F2). |

Tests also import deep paths (`*Workspace/.../*.spec.tsx`, `*Project/.../snapshotHelpers.spec.ts`, etc.); these are listed for completeness but are lower priority because the dep-cruiser rules typically permit `*.spec.ts` deep imports for white-box testing.

### F6. Files inside a module import their own root barrel

A non-trivial number of files inside `src/modules/Arrangement/` import from `#/modules/Arrangement` (their own barrel). The exact count for `Arrangement` alone is **162** files importing from `#/modules/Arrangement/...` (a mix of self-barrel imports and intra-module deep imports — both forbidden by §3.3 rule 6).

Representative examples:

| File | Import |
| ---- | ------ |
| `src/modules/Arrangement/stores/clipboardStore.ts` | `import { type Clip } from '#/modules/Arrangement/models/Track';` (self-deep into private folder) |
| `src/modules/Arrangement/stores/takeLaneStore.ts` | `import { type TakeLane } from '#/modules/Arrangement/models/TakeLane';` |
| `src/modules/Arrangement/repositories/presets/bassPresets.ts` | `import { type SoundPreset } from '#/modules/Arrangement/models/SoundPreset';` |
| `src/modules/Arrangement/presentations/views/TrackHeader/InputSelector.tsx` | `import { setTrackInput } from '#/modules/Arrangement/useCases/setTrackInput';` |
| `src/modules/Arrangement/presentations/views/TrackHeader/ResizeHandle.tsx` | `import { setTrackHeight } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight';` |
| `src/modules/Arrangement/presentations/renderers/createCanvasRenderer.ts` | `import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';` |
| `src/modules/Arrangement/presentations/helpers/timelineTools.ts` | `import { trackStore } from '#/modules/Arrangement/stores/trackStore';` |
| `src/modules/Arrangement/handlers/track/disableTrack.ts` | `import { disableTrack } from '#/modules/Arrangement/useCases/toggleTrackState/disableTrack';` |
| `src/modules/Arrangement/useCases/newFeatureHandlers.ts` | `import ... from '#/modules/Arrangement/useCases/fillTransitionGeneration/generation';` |

The same pattern almost certainly exists in other large modules; only `Arrangement` was counted exhaustively.

### F7. Multi-export repository files

The architecture doc says repositories are also one function per file (§4.9). **56** files under `src/modules/**/repositories/` violate this. Worst offenders:

| Exports | File |
| ------- | ---- |
| 20 | `src/modules/AudioEngine/repositories/webMidi/state.ts` |
| 16 | `src/modules/Sampler/repositories/samplerBridge.ts` |
| 16 | `src/modules/Arrangement/repositories/presets/presetHelpers.ts` |
| 12 | `src/modules/AudioEngine/repositories/devices/modulation.ts` |
| 11 | `src/modules/AudioEngine/repositories/devices/toneShaping.ts` |
| 10 | `src/modules/AudioEngine/repositories/webMidi/lifecycle.ts` |
| 9 | `src/modules/Levain/repositories/sampleLoader.ts` |
| 9 | `src/modules/CrdtDocument/repositories/crdtPersistence.ts` |
| 8 | `src/modules/AudioEngine/repositories/devices/{reverbDelay,dynamics}.ts` |
| 7 | `src/modules/{ProofChamber,CrdtDocument,AudioEngine}/repositories/...` |

Several of these are also misnamed (`samplerBridge.ts`, `presetHelpers.ts`, `state.ts`, `lifecycle.ts`) — they bundle whole subsystems into one file.

### F8. Sub-folder barrels

Only the module root `index.ts` may act as a barrel. There are two sub-folder `index.ts` files in the codebase:

| File | Contents | Verdict |
| ---- | -------- | ------- |
| `src/modules/AudioEngine/repositories/webMidi/index.ts` | Re-exports `MidiInputInfo`/`WebMidiState` types from `../../models/WebMidiTypes` plus a store and several lifecycle functions | **Violation** — sub-barrel that also re-exports from `models/`. |
| `src/modules/Workspace/presentations/views/Inspector/layouts/index.ts` | A pure side-effect entry point that imports layout files for their side effects | **Borderline.** Not a re-export barrel, just a side-effect bundle. Acceptable if renamed to `registerLayouts.ts`; flagged because the filename is misleading. |

### F9. "Handlers" files acting as multi-use-case dumping grounds

These overlap with `.agents/audits/handlers-pattern.md` but the worst legacy spikes are worth pinning here too because they are also F1 + F2 offenders simultaneously:

| File | Exports | Notes |
| ---- | ------- | ----- |
| `src/modules/Workspace/useCases/workspaceHandlers.ts` | ~35 | Sole owner of every workspace-side `AppAction`. |
| `src/modules/Workspace/useCases/togglePanel/panelToggles.ts` | 33 | Bundles every panel toggle into a single file. |
| `src/modules/Workspace/useCases/panels/devicePanels.ts` | 29 | Same shape, device panels. |
| `src/modules/AudioEngine/useCases/finalFeatureHandlers.ts` | 14 | Catch-all for "final feature" handlers. |
| `src/modules/Arrangement/useCases/deviceHandlers.ts` | 13 | 13 `execute*` functions, several touching different concerns. |
| `src/modules/Arrangement/useCases/batchFeatureHandlers.ts` | 10 | Catch-all by intent. |
| `src/modules/Arrangement/useCases/newFeatureHandlers.ts` | 8 | Catch-all by intent. |

These should migrate to `handlers/` per module, with `createHandler` per action (one file per handler), assembled by a single `get<Module>Handlers` use case (see handlers-pattern audit for the canonical shape).

### F10. React/TS convention smells (lower priority but visible)

Sampled, not exhaustive — included because they often co-occur with the structural issues above and are easy to spot during the same passes:

- `React.memo` usage in: `Fermenter/presentations/components/PresetBrowser.tsx`, `Project/presentations/views/ExportDialog.tsx`, `Workspace/presentations/components/SourdawLogo.tsx`, `Workspace/presentations/views/PreferencesDialog.tsx`, `Yeast/presentations/views/YeastPanel.tsx`. The React Compiler is active — `memo` is forbidden by `AGENTS.md`.
- `interface` declarations: `Arrangement/presentations/hooks/useTimelineGestures.ts:12` (`interface GestureEvent extends UIEvent`). Repo prefers `type`. (`Project/repositories/nativeProjectFiles.ts` uses `interface Window` for global augmentation, which is the only legal use of `interface`.)
- Conditional rendering with `&&` in JSX: `Project/presentations/views/TemplateChooser.tsx`, `Workspace/presentations/components/SourdawLogo.tsx` (sample). Repo policy is ternaries or early returns.
- `useEffect`-based data fetching in presentation components: ~10 components across `Arrangement/presentations/views/`, `GrandBoule/presentations/components/`, `Toaster/presentations/views/` (sample). Repo policy is TanStack Query.

These are not the focus of this audit and were not exhaustively counted.

---

## Issues

Each issue lists what it covers, where to start, and what closing it looks like. Issues are independent unless noted.

### Issue 1 — `engineAccess.ts` is a textbook fake-boundary file (CRITICAL)

`src/modules/AudioEngine/useCases/engineAccess.ts` exports 21 symbols, including:

- 16 thin wrapper functions (some legitimate, some pure delegations)
- a model type and a model factory re-exported from `../models/SidechainRoute`
- three repository functions re-exported from `../repositories/linkBridge`

It is single-handedly responsible for the F2 model-leakage **and** F2 repository-laundering categories, and is the source of the cross-module identity coupling on `SidechainRoute` (see Issue 3).

**Needed:** split into one file per function under `useCases/`, drop both `export type { SidechainRoute }` and `export { createSidechainRoute }` (move to a use case that defines its own type), and replace the three `export { … } from '../repositories/linkBridge'` lines with three real use cases that wrap the repo with a typed signature. Update `AudioEngine/index.ts` re-exports to track the new file layout. Run `pnpm deps:validate` after each batch.

### Issue 2 — `aiRuntimeQueries.ts` is a shadow public surface for `AiRuntime/repositories/` (CRITICAL)

`src/modules/AiRuntime/useCases/aiRuntimeQueries.ts` is a 23-export file that re-exports 7 distinct repository functions (`getActiveModelId`, `streamCloudChatCompletion`, `readLevels`, `readFrequencyBalance`, `generateWebLlmCompletion`, `generateNativeCompletion`, `isNativeEngineReady`). Other modules import these symbols believing they hit a use case; in reality every call goes straight to the repository with no translation.

**Needed:** delete every `export { … } from '../repositories/...'` line. For each one, decide whether it should become a real typed use case (with input/output types declared in that file) or whether the consumer should be calling a higher-level use case instead. Split the remaining query functions into one file per export. This file should not survive as a single artifact.

### Issue 2b — `isComplexPrompt` is a transformer being consumed cross-module by a presentation hook (CRITICAL)

`AiRuntime/transformers/promptParser/parsing` exports `isComplexPrompt`. It is laundered through **two** use case files (`aiRuntimeQueries.ts:176`, `parsePromptToActions.ts:16`), promoted to `AiRuntime/index.ts`, and then consumed by `Workspace/presentations/hooks/usePromptExecution.ts:378` (`const willUseLlm = value.trim().length > 0 && isComplexPrompt(...)`). Three rules collapse at once:

- Transformers do not cross modules (§4.10).
- Hooks consume use cases, not transformers, services, validators, or repositories.
- A transformer that "needs" to be shared was misclassified — it is not actually a transformer.

The same pattern recurs at `aiRuntimeQueries.ts:172` for `detectIssues, generateSuggestions` from `transformers/mixAnalysisTransformers`.

**Needed:**

1. Decide what `isComplexPrompt` actually is. The question to ask: if Workspace did not exist, would AiRuntime still need a public function called `isComplexPrompt`? If no, then the *behaviour* that Workspace wants is not "is this prompt complex?" — it is something like "should this prompt route to the LLM?" That is a use case, not a transformer. Define `shouldUseLlmForPrompt(input: { value: string }): boolean` (or similar) as a real use case in `AiRuntime/useCases/`, declare it on `index.ts`, and have the Workspace hook call that. The transformer becomes a private implementation detail of the new use case, exactly where transformers are supposed to live.
2. Apply the same treatment to `detectIssues` / `generateSuggestions`. If Workspace (or wherever they are consumed) needs the *result* of mix analysis, that result should come from a use case that runs the analysis and returns a typed shape — not from a presentation layer reaching for a transformer.
3. Delete the launder lines (`aiRuntimeQueries.ts:172`, `aiRuntimeQueries.ts:176`, `parsePromptToActions.ts:16`).
4. Audit the rest of `Workspace/presentations/hooks/` and `Workspace/presentations/components/` for cross-module imports of anything that is not a use case, store, or view. The `usePromptExecution.ts` import block alone (lines 4–17) reaches for ~12 symbols across `#/modules/AiRuntime`; some of those are use cases (correct) and some are not — each one needs to be classified.

This is listed as Issue 2b because it is the same fix pattern as Issue 2 (`aiRuntimeQueries.ts`) and they should be done in the same pass.

### Issue 3 — `SidechainRoute` is co-owned by two modules through laundered re-exports (HIGH)

`SidechainRoute` is a model type defined in `AudioEngine/models/SidechainRoute.ts`. It is then:

1. Re-exported from `AudioEngine/useCases/engineAccess.ts` (F2)
2. Re-exported from `AudioEngine/index.ts` line 82 (F3)
3. Re-imported in `Routing/useCases/sidechain.ts` from `#/modules/AudioEngine`
4. Re-exported again from `Routing/index.ts` line 4 as if it were a Routing concept

Now Arrangement, Command, and any other consumer can pick either module's barrel to import the same identity. The "different modules use different types of the same shape" rule from §4.1 is fully broken here.

**Needed:** delete the re-exports in `engineAccess.ts`, `AudioEngine/index.ts`, and `Routing/index.ts`. Define a local `SidechainRoute` shape inside `Routing` (it will be a different identity, which is the intended behaviour). Update the AudioEngine sidechain wiring functions to take a plain object input instead of leaking the model type across the boundary.

### Issue 4 — `Yeast/index.ts` directly re-exports from `models/` (HIGH)

Line 4: `export type { MidiEvent, TransportInfo } from './models/MidiEvent';`

This is the only module-root `index.ts` that re-exports directly from `./models/`. It is also the simplest fix.

**Needed:** delete the line. Audit consumers of `MidiEvent`/`TransportInfo` from `#/modules/Yeast`; each should either define its own local type or, if the type carries event semantics, the type should move to `Yeast/events/` and be re-exported from `index.ts` from there.

### Issue 5 — `DrumKit` / `DrumKitVoice` and `AutomationShapeType` are co-owned by two modules each (HIGH)

- `DrumKit`/`DrumKitVoice` is re-exported from both `Synth/index.ts:8` (`from './useCases/drumKitSynth'`) and `AudioEngine/index.ts:44` (`from './useCases/audioEngineQueries'`).
- `AutomationShapeType` is re-exported from both `Automation/index.ts:80` (`from './useCases/automationShapes'`) and `Arrangement/index.ts:274` (`from './useCases/automationQueries'`).

Same identity, two public surfaces. Consumers can pick either, and the modules are silently coupled through the type.

**Needed:** decide a single owner for each type. The other module either drops the export entirely, or duplicates the shape locally with its own name.

### Issue 6 — Models leaking across module boundaries via deep imports (HIGH)

`src/modules/Transport/useCases/evaluateFollowActions.ts:1` imports `Clip` and `Track` directly from `#/modules/Arrangement/models/Track`. This is a textbook §4.1 model-isolation violation: Transport has no business knowing the exact shape of Arrangement's `Clip` and `Track`.

**Needed:** define local `EvaluatedClip` / `EvaluatedTrack` shapes inside Transport with only the fields `evaluateFollowActions` actually reads. The Arrangement caller adapts at the boundary.

Search the rest of the codebase (`#/modules/<Any>/models/`) for the same pattern after this is closed — there are likely more.

### Issue 7 — `Arrangement` and other large modules import from their own barrel (HIGH)

162 files inside `src/modules/Arrangement/` import from `#/modules/Arrangement/...`. This is a mix of:

- Self-barrel imports (`#/modules/Arrangement` from a file inside Arrangement) — forbidden by §3.3 rule 6.
- Intra-module deep imports through the alias (`#/modules/Arrangement/stores/...`) — forbidden by §3.3 rule 1 even for in-module callers, because they obscure the dependency graph and invite circular initialisation.

**Needed:** convert each one to a relative path. This is mechanical but must be done one file at a time per `AGENTS.md` "no automated bulk edits" rule. Start with the highest-traffic stores (`trackStore`, `takeLaneStore`, `clipboardStore`) and the `presentations/` files that reach into `useCases/` deep paths. Run `pnpm deps:validate` after every ~10 files.

After Arrangement is clean, audit `Workspace`, `AudioEngine`, `AiRuntime`, `Plugin`, and `Project` for the same pattern.

### Issue 8 — Multi-use-case files in `useCases/` (HIGH, broad scope)

248 files violate one-function-per-file. The 24 worst offenders (10+ exports each) are the priority and overlap heavily with F2 and F9.

**Needed:** for each file in the F1 table, split into one file per export, give each its own typed signature, and update the module's `index.ts` to track the new layout. The non-handler ones first (`timelineViewActions.ts`, `panelToggles.ts`, `devicePanels.ts`, `aiRuntimeQueries.ts`, `engineAccess.ts`, `workspaceQueries.ts`, `proofParamBridge.ts`, `levainParamBridge.ts`, `toasterParamBridge.ts`, `calibrateGrandBouleMidi.ts`, `compilerEngine.ts`, `hostOperations.ts`, `compensation.ts`, `commandQueries.ts`, `selectionHelpers.ts`, `sessionManagement.ts`, `serializeLogicalState.ts`); the handler ones (`workspaceHandlers.ts`, `togglePanel/panelToggles.ts`, `panels/devicePanels.ts` if they double as handlers, `finalFeatureHandlers.ts`, `deviceHandlers.ts`, `batchFeatureHandlers.ts`, `newFeatureHandlers.ts`) should be merged into the existing handlers-pattern migration plan.

### Issue 9 — Lowercase non-model files inside `models/` (MEDIUM)

52 files. Concentrations:

- `AiRuntime/models/` (24 files): the `tools/`, `patterns/`, `presetActions/` trees are registries and pattern banks. They should move to `services/` (for the registries) or `repositories/` (for the pattern banks treated as data sources). `toolDefinitions.ts` and `midiPatternLibrary.ts` are top-level lowercase files in `models/` and need the same treatment.
- `Arrangement/models/pluginDescriptors/` (15 files): these are descriptor data tables, not domain models. They should move to `services/pluginDescriptors/` or to a new `data/` folder.
- `Command/models/commands/` (10 files): the AppAction enumeration tables. They should move to `services/commands/` or alongside `commandQueries`.
- `Transport/models/{loopStation,setlistItem,punchRecording}Helpers.ts`: pure helper functions — move to `services/` or `transformers/` of Transport.
- `AudioEngine/models/factoryDrumKits.ts`: a fixture — move to `repositories/` or to a `data/` folder.

**Needed:** move each file to the appropriate folder one at a time, update imports, run `pnpm deps:validate`. The destination folder should be chosen per the §4 definitions of `services/` (stateless logic spanning entities), `transformers/` (pure mapping), and `repositories/` (I/O / data sources).

### Issue 10 — Multi-export repository files (MEDIUM)

56 repository files export multiple symbols. The top 10 are listed in F7. The fix is mechanical: split into one function per file, rename the parent folder if appropriate.

**Needed:** start with the largest (`webMidi/state.ts:20`, `samplerBridge.ts:16`, `presetHelpers.ts:16`, `devices/modulation.ts:12`). Several are also part of WebMidi/Sampler subsystems whose folder layouts could use cleanup at the same time.

### Issue 11 — Sub-folder barrel `webMidi/index.ts` (MEDIUM)

`src/modules/AudioEngine/repositories/webMidi/index.ts` is a sub-barrel that also re-exports from `models/`. It should be deleted; consumers should import the underlying files directly via relative paths.

`Workspace/presentations/views/Inspector/layouts/index.ts` is borderline (side-effect imports only) — rename to `registerLayouts.ts` or leave with a comment explaining it is not a re-export barrel.

### Issue 12 — Use-case-defined types on module `index.ts` are pervasive (MEDIUM, broad scope)

After Issues 3, 4, and 5 close the most dangerous cases, ~30 `export type { … } from './useCases/...'` lines remain across module roots (full list in F3). The new rule (§4.4 / §6.5) tolerates this for **types declared inside the use case file**, but flags it as discouraged. Each one is a candidate for one of:

- Move to `events/` if the type carries event semantics.
- Replace with a `ReturnType<typeof fn>` derivation in the consumer.
- Replace with a local DTO in the consumer.

**Needed:** triage the list one module at a time, removing exports as consumers are converted. This is not a single PR — it can be done opportunistically as those modules are touched for other work.

### Issue 13 — React.memo / interface / `&&` JSX / `useEffect` smells (LOW)

The five `React.memo` files, the one bare `interface` declaration, and the `&&` JSX usages should each be replaced. This is unrelated to the architectural work and can be addressed independently.

---

## Priorities

In order of impact:

1. **Issue 1** — `engineAccess.ts` (concentrates F1 + F2 + F3 + F5 in one file).
2. **Issue 2** — `aiRuntimeQueries.ts` (shadow public surface for an entire repository tree).
2b. **Issue 2b** — `isComplexPrompt` and the AiRuntime transformer launders (presentation layer reaches a foreign transformer; same fix pass as Issue 2).
3. **Issue 3** — `SidechainRoute` co-ownership (cross-module identity coupling).
4. **Issue 6** — Cross-module deep imports of `Arrangement/models/Track` (model isolation).
5. **Issue 4** — `Yeast/index.ts` direct model re-export (smallest fix, highest signal).
6. **Issue 5** — `DrumKit` / `AutomationShapeType` co-ownership.
7. **Issue 7** — Self-barrel and intra-module deep imports inside `Arrangement` (162 files).
8. **Issue 8** — Multi-use-case files (248 files; the 24 worst offenders first).
9. **Issue 9** — Lowercase non-model files in `models/` (52 files; AiRuntime first).
10. **Issue 10** — Multi-export repository files (56 files).
11. **Issue 11** — Sub-folder barrels (2 files).
12. **Issue 12** — Discouraged use-case type re-exports on module roots.
13. **Issue 13** — React/TS convention smells.

---

## Risks

- **Hidden cross-module coupling.** Issues 3 and 5 mean two modules currently agree on the *exact* memory shape of types like `SidechainRoute` and `DrumKit`. A future refactor of either module's internals will silently break the other unless these are split first.
- **Repository changes break consumers without warning.** Every `export { … } from '../repositories/...'` line in a use case file (F2, Issue 2) means a private repository signature change cascades into every cross-module consumer with no compile-time boundary in between. This is the precise failure mode the architecture exists to prevent.
- **Multi-export use-case files actively obscure other violations.** Files like `engineAccess.ts` and `aiRuntimeQueries.ts` are large enough that grepping for `export type { Foo }` would have caught the model leak years ago — but the violations are buried in 200+ line files. F1 makes every other class of violation harder to detect.
- **Self-barrel imports cause initialisation-order bugs.** The 162 `Arrangement` files importing from `#/modules/Arrangement` are at risk of circular initialisation — the symptom is `undefined is not a function` errors at module load time, often only at production bundle time. This is a latent bug factory.
- **Lowercase files in `models/`** train new contributors (and AI agents) to put non-model code in `models/`. The convention erodes faster the longer it is broken.
- **Bulk fixes are dangerous.** Per `AGENTS.md` and the user's standing memory, bulk edits (sed/awk/codemods) are forbidden. The total volume of changes implied by this audit (~500 files across all issues) means the work must be planned in small, validated batches with `pnpm deps:validate` between them.

---

## Suggested approaches

These are directional only. A proper spec should be written before any of this work starts.

- **Sequence by leverage.** Issues 1–6 are localised, high-signal, and unblock the long tail. Doing them first gives the cleanup the most concrete reference points (`engineAccess.ts`, `aiRuntimeQueries.ts`) for "what good looks like" before tackling the 248-file tail.
- **One module at a time for the long tail.** Issues 7–10 are most tractable when scoped to one module per session: pick `Arrangement` first (largest, most leverage), then `AudioEngine`, then `AiRuntime`, then `Workspace`. Run `pnpm deps:validate` after every ~10 files per the shock-collar rule.
- **Move files, then split, then rename.** For each multi-export use case file: first split (one file per export, no behaviour changes), then look for re-exports to delete, then rename anything that's misnamed.
- **Make the fakes load-bearing.** Before deleting a `export { x } from '../repositories/...'` line, define the *real* use case the consumer should be calling. This sometimes reveals that the consumer is doing work the use case layer should have been doing — that work moves up at the same time.
- **Treat lowercase model files as a separate sweep.** They are independent of the use-case/index.ts work and can be done in parallel by another session without conflict.
- **Each PR runs `pnpm deps:validate` and `pnpm typecheck`.** The dep-cruiser rules already catch some of these (cross-module deep imports, models on `index.ts`). Many do not have rule coverage yet — see "Open questions" below.

---

## Open questions

1. **Should `pnpm deps:validate` catch `export { … } from '../repositories/...'` inside `useCases/`?** It currently does not. If the laundering pattern is the worst offender, a `no-launder-from-repositories` rule (forbid `export ... from '../repositories'` in `useCases/**/*.ts`) would prevent regressions during the cleanup. **Worth confirming with the user before adding a new rule** — touching dep-cruiser config is out of scope for this audit.
2. **Should sub-folder barrels be a hard rule?** Currently the rule is documented in §3.3 and the skill but is not enforced by dep-cruiser. Both detected sub-barrels (Issue 11) suggest it is worth a rule.
3. **Should `models/` enforce PascalCase filenames?** The convention is documented informally; a glob-based rule would prevent the F4 backlog from regrowing.
4. **What is the right home for the AiRuntime registries?** `services/`, `repositories/`, or a new `data/` folder per module? This decision should be made once, then applied to AiRuntime and Arrangement consistently.

---

## Resolved

(none yet — this is a fresh audit)
