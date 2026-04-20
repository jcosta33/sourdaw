# Dead Code Audit — Knip Configuration & Findings

## Scope

This audit covers the accuracy and completeness of the project's **Knip** (dead-code detection) configuration, the legitimacy of its current output, and the classification of flagged code into:

1. **False positives** caused by knip misconfiguration.
2. **Legitimate dead code** that can be safely removed.
3. **Unfinished / unwired legitimate features** that are intentionally present but not yet connected.

It explicitly excludes the Rust/Tauri backend (`src-tauri/`, `crates/`) and build tooling outside `package.json`.

## Goal

Knip produces a clean, trustworthy report where:
- Every "unused" finding is either removable dead code or explicitly documented as an intentional stub/frozen feature.
- No false positives arise from missing entry points, excluded test files, or ignored source directories.
- All unresolved imports represent real broken imports, not configuration artifacts.

## Relevant code paths

- `knip.json` — knip configuration
- `package.json` — dependency declarations and scripts
- `tsconfig.json` — TypeScript path mapping (`#/*`)
- `src/app/main.tsx` — Vite application entry point
- `src/routes/` — TanStack Router route files (currently the only knip entry)
- `src/components/` — UI components (entirely ignored by knip)
- `src/modules/*/events/index.ts` — module event barrel files
- `src/modules/*/useCases/` — feature use-case directories
- `src/modules/*/stores/` — feature stores
- `src/modules/AudioEngine/services/` — AudioWorklet processor services
- `src/modules/MIDI/workers/` — Web Workers
- `scripts/` and `codemods/` — build/utility scripts

## Current behavior

### Knip version & invocation
- **Version:** 6.3.1
- **Command:** `npx knip --no-exit-code`
- **Output summary (fresh run, 2026-04-20):**
  - Unused files: **91**
  - Unused dependencies: **1**
  - Unused devDependencies: **4**
  - Unresolved imports: **19**
  - Unused exports: **86**
  - Unused exported types: **22**
  - Configuration hints: **10**

### Configuration (`knip.json`)
```json
{
    "$schema": "https://unpkg.com/knip@latest/schema.json",
    "entry": ["src/routes/**/*.tsx"],
    "project": ["src/**/*.{ts,tsx}", "!src/**/*.spec.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/routeTree.gen.ts"],
    "ignore": [
        "src/components/**/*.tsx",
        "src/modules/Levain/repositories/levainPresets.ts",
        "src/modules/Plugin/models/ProofChamberState.ts",
        "src/modules/Plugin/stores/chamberStore.ts",
        "src/modules/Toaster/models/GrooveTemplates.ts",
        "src/modules/Workspace/presentations/components/Sidebar/SectionHeader.tsx",
        "src/modules/Workspace/useCases/automationSubLanes.ts",
        "src/modules/Arrangement/useCases/clipGainEnvelope/getAllClipGainEnvelopes.ts",
        "src/modules/Arrangement/useCases/clipGainEnvelope/moveGainEnvelopePoint.ts"
    ],
    "ignoreExportsUsedInFile": true,
    "ignoreDependencies": ["@tauri-apps/plugin-fs", "tailwindcss", "@typescript-eslint/eslint-plugin"],
    "ignoreBinaries": ["prettier", "wasm-pack"]
}
```

## Findings

### 1. Knip configuration produces systemic false positives

#### Missing entry points
The only declared entry is `src/routes/**/*.tsx`. The actual Vite entry point `src/app/main.tsx` is missing. Consequently, anything imported only from `main.tsx` (or its bootstrap chain) is flagged as unused. Similarly missing:
- `src/app/main.tsx` — primary application entry.
- `src/modules/MIDI/workers/controller-scripting.worker.ts` — dynamically loaded Web Worker.
- `src/modules/AudioEngine/engine/workletInitShared.ts` — dynamically loaded AudioWorklet.
- `scripts/*.ts` and `codemods/*.ts` — Node/CLI scripts that import project code.

#### Tests excluded from the project
The `project` glob explicitly excludes `**/*.spec.{ts,tsx}` and `**/*.test.{ts,tsx}`. This means **any export consumed only by tests is reported as unused**. This is the single largest source of noise. Examples:
- `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` from `src/components/ui/card.tsx` — used exclusively in `src/components/ui/__tests__/card.spec.tsx`.
- `createUndoEntry`, `generateGroupId`, `isActionEntry` from `src/modules/Command/models/UndoEntry.ts` — used in tests.
- Most `…Dependencies` helper objects (DI dependency maps) — consumed by unit tests.

#### Overbroad `ignore` of components
`"ignore": ["src/components/**/*.tsx"]` tells knip to **skip the entire directory**. This hides real dead components and also means cross-imports from components into other modules are not traced correctly. The `.tsx` filter does not catch `.ts` utility files inside `src/components/daw/`, which is why `STANDARD_FREQ_MARKS` and `STANDARD_DB_MARKS` from `spectrumMath.ts` are still flagged.

#### Dynamic imports not resolved
`@tauri-apps/plugin-fs` is used in production code via dynamic `await import('@tauri-apps/plugin-fs')` (`src/modules/Project/presentations/views/ExportDialog.tsx`, `src/modules/Project/useCases/projectPersistence/fileIO/pickAndImportProjectFile.ts`, etc.). Knip does not trace dynamic imports without configuration, so the dependency appears unused and was manually added to `ignoreDependencies`. This should be fixed with `webpack` or `dynamicImports` configuration rather than ignored.

#### Stale ignore entries
Knip's configuration hints explicitly recommend removing **8 files** from `ignore` because they no longer exist or are now legitimately detected as unused:
- `src/modules/Plugin/models/ProofChamberState.ts`
- `src/modules/Plugin/stores/chamberStore.ts`
- `src/modules/Toaster/models/GrooveTemplates.ts`
- `src/modules/Workspace/presentations/components/Sidebar/SectionHeader.tsx`
- `src/modules/Workspace/useCases/automationSubLanes.ts` (now a directory, not a file)
- `src/modules/Arrangement/useCases/clipGainEnvelope/getAllClipGainEnvelopes.ts`
- `src/modules/Arrangement/useCases/clipGainEnvelope/moveGainEnvelopePoint.ts`

Also recommended for removal from `ignoreDependencies`:
- `@tauri-apps/plugin-fs` — actually used (dynamic imports).
- `@typescript-eslint/eslint-plugin` — not directly imported in source, but used by ESLint config; removing it from `ignoreDependencies` would flag it again. Legitimate to keep ignored or move to `eslint` plugin config.

### 2. Legitimate dead code (safe to remove)

#### Broken imports in tests (19 unresolved imports)
These are **real compilation errors** in test files, not knip artifacts:

| Import | File | Issue |
|--------|------|-------|
| `#/utils/Logger/Logger` | `src/modules/AudioAnalysis/repositories/__tests__/audioAiEngine.spec.ts` | Path does not exist. Actual logger is at `#/infra/logger`. |
| `../wasm/workletPolyfill.js` | 9 files under `src/modules/AudioEngine/services/` | File does not exist in source tree. Likely a build artifact from wasm generation. |
| `../../../models/SamplerTypes` | `src/modules/Crumbs/presentations/components/__tests__/PadGrid.spec.tsx` | Should be `../../../models/CrumbsTypes`. |
| `../../stores/grandBouleStore` | `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/__tests__/helpers.spec.ts` | Wrong relative depth. Should be `../../../stores/grandBouleStore`. |
| `#/modules/DeviceBrowser/useCases` | `src/modules/Plugin/useCases/__tests__/pluginBrowserActions.spec.ts` | Module `DeviceBrowser` has no `useCases` directory. Mock target does not exist. |
| `#/utils/Logger/Logger` | `src/modules/MIDI/useCases/__tests__/midiLearn.spec.ts` | Same stale logger path. |
| `#/utils/Logger/Logger` | `src/modules/Toaster/useCases/__tests__/toasterSubscriber.spec.ts` | Same stale logger path. |
| `../../models/MidiEvent` | 4 Yeast test files (`Arpeggiator`, `ChordGenerator`, `Humanizer`, `Transposer`) | Wrong relative depth. Should be `../../../models/MidiEvent`. |

**Impact:** These tests are either failing in CI or not being executed. The `../wasm/workletPolyfill.js` imports in AudioEngine services are also suspicious — if the file is generated at build time, the import is valid at runtime but fails static analysis. If it is not generated, these processors are broken.

#### Truly unused exports (sampled)
- `STANDARD_FREQ_MARKS`, `STANDARD_DB_MARKS` (`src/components/daw/spectrumMath.ts`) — defined, exported, never imported.
- `classifyDso` (`src/modules/AiRuntime/models/DsoTypes.ts`) — never imported outside its file.
- `deleteEnvelope` (`src/modules/Arrangement/stores/gainEnvelopeStore.ts`) — never imported.
- `copySelectedNotesDependencies` (`src/modules/Arrangement/useCases/clipboard/copySelectedNotes.ts`) — never imported (the use-case itself may be wired, but the DI helper is orphaned).
- `addGainEnvelopePointDeps`, `toggleClipGainEnvelopeDeps` — same pattern: orphaned DI helpers.
- `WEBLLM_MODEL_INFO`, `getWebLlmModelById` (`src/modules/AiRuntime/models/ModelInfo.ts`) — re-exported from `useCases/index.ts` but never consumed by the app.

#### Unused dependencies
- `@huggingface/transformers` — listed in `package.json` dependencies but **only mentioned in a code comment** (`src/modules/BrowserAi/workers/tfjsInferenceWorker.ts`). No actual import.
- `sinon` — not imported anywhere.
- `ts-morph` — not imported anywhere.
- `@types/jscodeshift` — not imported anywhere (`jscodeshift` itself is used only as a CLI binary in the `codemod` script).
- `@types/sinon` — types for unused `sinon`.

### 3. Unfinished / unwired legitimate features (do not delete)

#### Empty module event barrels (~15 modules)
Files like `src/modules/AiGeneration/events/index.ts`, `src/modules/CrdtDocument/events/index.ts`, `src/modules/Bacteria/events/index.ts` contain only a comment (`// no public events`). These are **architectural placeholders** following the repo's DDD module convention. Every module is expected to expose an `events/index.ts` public contract; when a module has no domain events, the file is intentionally left as a stub. **Do not remove** without changing the architectural convention.

#### Feature directories with stores but unwired useCases
Several substantial features have fully implemented stores and use-case directories, but the useCases are not imported by any handler or view:

| Feature | Store exists | UseCases exist | Wired? | Notes |
|---------|-------------|----------------|--------|-------|
| Control Room | `src/modules/AudioEngine/stores/controlRoom.ts` | `src/modules/AudioEngine/useCases/controlRoom/` | ❌ | Store tested. UseCases for monitor/cue/talkback are complete but not called. |
| RAVE (AI timbre transfer) | `src/modules/AudioEngine/stores/rave.ts` | `src/modules/AudioEngine/useCases/rave/` | ❌ | Store tested. UseCases for encode/decode/interpolate are complete. |
| Elastic Audio | — | `src/modules/AudioEngine/useCases/elasticAudio/` | ❌ | No store. UseCases for transient detection/quantization exist. |
| Sample Player | — | `src/modules/AudioEngine/useCases/samplePlayer/` | ❌ | No store. UseCases for SFZ playback exist. |
| Loop Station | `src/modules/Transport/stores/loopStationStore.ts` | `src/modules/Transport/useCases/loopStation/` | ❌ | Store tested. UseCases for slot CRUD exist. |
| Punch Recording | `src/modules/Transport/stores/punchRecordingStore.ts` | `src/modules/Transport/useCases/punchRecording/` | ❌ | Store tested. UseCases for pre/post roll, background capture exist. |
| Setlist | `src/modules/Transport/stores/setlistStore.ts` | `src/modules/Transport/useCases/setlist/` | ❌ | Store tested. UseCases for item CRUD/reordering exist. |
| DAWproject import/export | — | `src/modules/Project/useCases/dawProject/` | Partial | `exportDawProject` action and handler exist, but the underlying `parseDawProject.ts` / `exportDawProject.ts` useCases are not called by the handler. |
| Music Mentor | — | `src/modules/AiRuntime/useCases/musicMentor/` | Partial | `getMentorTips` action/handler exist, but handler does not call `getMentorTip()` from useCases. |
| Modulation System | — | `src/modules/Plugin/useCases/modulationSystem/` | ❌ | Complete CRUD for modulation routes. No UI wired. |
| Node View | `src/modules/Plugin/stores/nodeView.ts` | `src/modules/Plugin/useCases/nodeView/` | ❌ | Store and useCases for graph editor exist. |
| Push Integration | `src/modules/Plugin/stores/push.ts` | `src/modules/Plugin/useCases/pushIntegration/` | ❌ | Ableton Push 2 support. Store and useCases present. |

These are **intentionally built but not yet shipped features**. Deleting them would destroy legitimate product work.

#### Extension system (frozen)
`src/modules/Extension/stores/extension.ts` contains an explicit comment:
> TODO: FROZEN — Extension system is architecturally sound (types, manifest, store) but execution runtime is unsafe (new Function).

All extension useCases (`installExtension`, `toggleExtension`, `executeCommand`, etc.) are flagged as unused. This is correct — the feature is deliberately disabled — but the code should be preserved until the sandboxing issue is resolved.

#### Adjustment Layer system
`src/modules/Arrangement/useCases/adjustmentLayer/` contains 9 use-case files. They are not imported anywhere. This appears to be an unfinished feature (adjustment regions for non-destructive editing) with no corresponding store or UI.

#### Automation sub-lanes
`src/modules/Workspace/useCases/automationSubLanes/` (directory with `addAutomationSubLane.ts`, `removeAutomationSubLane.ts`, etc.) has tests but no production consumers.

#### Inspector effect layouts
`src/modules/Workspace/presentations/views/Inspector/layouts/effects/` contains ~16 layout components (`BitcrusherLayout.tsx`, `CompressorLayout.tsx`, etc.). They are not imported anywhere. Likely they are meant to be wired into an effect inspector that is not yet built.

#### Spectrogram view
`src/modules/Plugin/presentations/views/SpectrogramView.tsx` — a visualization component with no consumers.

## Priorities

1. **Fix broken test imports** (19 unresolved imports). These represent real test failures or stale paths after refactoring.
2. **Update knip configuration** to add missing entry points and include test files in the project scope. Without this, the report is too noisy to be actionable.
3. **Remove truly unused dependencies** (`@huggingface/transformers`, `sinon`, `ts-morph`, `@types/sinon`, `@types/jscodeshift`).
4. **Audit orphaned DI helpers** (`…Dependencies.ts` exports). Many are likely safe to delete if the corresponding use-case no longer uses DI injection.
5. **Document frozen/unfinished features** so future knip runs don't re-investigate the same directories.

## Open issues

1. **Knip entry points are incomplete.**
   - Missing `src/app/main.tsx`, workers, worklets, scripts.
   - **Needed:** Expand `entry` array to cover all static and dynamic entry points.

2. **Test files are excluded from the project scope.**
   - **Needed:** Remove `!src/**/*.spec.{ts,tsx}` from `project` (or add test files to `entry`) so that test-only exports are not flagged as unused.

3. **`src/components/**/*.tsx` is entirely ignored.**
   - **Needed:** Remove this blanket ignore. If specific generated files (e.g., shadcn/ui) should be ignored, list them individually or use a more specific glob.

4. **Broken test imports exist in 8+ test files.**
   - `src/modules/Crumbs/presentations/components/__tests__/PadGrid.spec.tsx` — wrong model path.
   - `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/__tests__/helpers.spec.ts` — wrong relative depth.
   - `src/modules/Plugin/useCases/__tests__/pluginBrowserActions.spec.ts` — mocks non-existent module.
   - 4 Yeast processor tests — wrong relative depth for `MidiEvent`.
   - 3 tests referencing `#/utils/Logger/Logger` — logger was moved to `infra/logger`.
   - **Needed:** Fix import paths or delete obsolete tests.

5. **`../wasm/workletPolyfill.js` is imported but does not exist in source.**
   - Imported from 9 AudioEngine processor files.
   - **Needed:** Determine if this file is generated by the wasm build (`wasm:dsp`, `wasm:proof-chamber` scripts) or if the import is stale. If generated, add the path to knip `ignore` or resolve alias.

6. **`@tauri-apps/plugin-fs` is incorrectly ignored.**
   - It is actively used via dynamic import. The `ignoreDependencies` entry masks a knip limitation.
   - **Needed:** Configure knip to resolve dynamic imports, then remove from `ignoreDependencies`.

7. **Stale `ignore` entries in `knip.json`.**
   - 8 entries flagged by knip itself as removable.
   - **Needed:** Remove stale paths from `ignore`.

## Open questions

- Are the inspector effect layouts (`src/modules/Workspace/presentations/views/Inspector/layouts/effects/`) intended to be wired soon, or are they abandoned? No store or registry imports them.
- Is the `workletPolyfill.js` import a build-time requirement, or can it be removed from the processor sources? The processors appear to function as AudioWorklets that may not need the polyfill at runtime.
- Should empty `events/index.ts` stubs be kept as a convention, or should the convention change to omit the file when a module has no events?
- Are the `…Dependencies.ts` DI helper files still required by the current DI system, or has the project moved to a different injection pattern (e.g., `createHandler` with inline deps)?

## Risks

- **Test rot:** Broken test imports suggest tests are not being run in CI or are silently skipped. This erodes confidence in the test suite.
- **Dependency bloat:** `@huggingface/transformers` is a large package. Keeping unused dependencies increases install time and bundle analysis noise.
- **False confidence in knip:** With ~90 unused files reported, most of which are legitimate unfinished features, developers may ignore knip output entirely, causing real dead code to accumulate.
- **Accidental deletion:** Without clear documentation, a future session running knip might delete unfinished features (e.g., loop station, punch recording, setlist) believing them to be dead code.

## Suggested approaches

1. **Restructure `knip.json`:**
   - Add `src/app/main.tsx` to `entry`.
   - Add `src/**/*.spec.{ts,tsx}` and `src/**/*.test.{ts,tsx}` to `entry` (not `project`) so test-only exports are considered used.
   - Add worker/worklet entry patterns.
   - Replace `src/components/**/*.tsx` ignore with specific ignores for generated shadcn files if necessary.
   - Remove all stale `ignore` entries flagged by knip.

2. **Fix broken imports before trusting knip:**
   - Run `pnpm test:run` to see which tests actually fail.
   - Fix or delete tests with stale imports.

3. **Document frozen features:**
   - Add a `knip.md` or inline comments in `knip.json` explaining why `src/modules/Extension/useCases/extension/` and other frozen directories are intentionally unwired.

4. **Remove confirmed dead code:**
   - Delete `@huggingface/transformers`, `sinon`, `ts-morph`, `@types/sinon`, `@types/jscodeshift` from `package.json`.
   - Delete orphaned exports like `STANDARD_FREQ_MARKS`, `classifyDso`, `deleteEnvelope` after confirming no dynamic/string-based imports exist.

## Recommendation

**Start with fixing knip configuration and broken test imports.** Do not delete any code in `src/modules/` until the configuration is corrected, because the current false-positive rate is too high to distinguish dead code from unfinished features safely.

Next step: create a spec to update `knip.json`, fix the 19 unresolved imports, and re-run knip to establish a clean baseline.

## Resolved

- ~~Stale `knip-results.txt` existed from pre-refactor state~~ — superseded by fresh run on 2026-04-20.
