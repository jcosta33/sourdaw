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
- `src/app/main.tsx` — Vite application entry point (auto-detected by knip via `index.html`)
- `src/routes/` — TanStack Router route files
- `src/components/` — UI components (now analyzed after removing blanket ignore)
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
- **Output summary (post-fix run, 2026-04-20):**
  - Unused files: **92**
  - Unused dependencies: **1**
  - Unused devDependencies: **2**
  - Unlisted dependencies: **2**
  - Unresolved imports: **10**
  - Unused exports: **92**
  - Unused exported types: **22**
  - Configuration hints: **1**

### Configuration (`knip.json`)
```json
{
    "$schema": "https://unpkg.com/knip@latest/schema.json",
    "entry": [
        "src/routes/**/*.tsx",
        "scripts/*.ts",
        "codemods/*.ts"
    ],
    "project": [
        "src/**/*.{ts,tsx}",
        "!src/**/*.spec.{ts,tsx}",
        "!src/**/*.test.{ts,tsx}",
        "!src/routeTree.gen.ts"
    ],
    "ignore": [],
    "ignoreExportsUsedInFile": true,
    "ignoreDependencies": ["tailwindcss"],
    "ignoreBinaries": ["prettier", "wasm-pack"]
}
```

## Findings

> **Validation (2026-04-20, independent re-run):** Output counts and categories above match a fresh `npx knip --no-exit-code`. All 10 unresolved imports reproduce verbatim. Unused deps (`@huggingface/transformers`, `sinon`, `@types/sinon`) and unlisted dep `glob` confirmed by grep. `workletPolyfill` imports confirmed absent from `src/` (commit `c2ddccaa`). Three claims in §3 are inaccurate and are corrected inline below (Control Room, Music Mentor, Adjustment Layer).

### 1. Knip configuration — FIXED

The following issues were identified and resolved:

#### Entry points — FIXED
Knip auto-detects `src/app/main.tsx` via `index.html` (Vite), so it does not need to be declared. Workers loaded via `new Worker(new URL(...))` and `?worker` imports are automatically traced by knip v6. `scripts/*.ts` and `codemods/*.ts` were added to `entry`.

#### Tests excluded from the project — INTENTIONAL
The `project` glob excludes `**/*.spec.{ts,tsx}` and `**/*.test.{ts,tsx}`. **This is deliberate** — test usages are not counted as real usages per project policy. Consequently, exports consumed only by tests are correctly reported as unused. This surfaces dead code such as:
- `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` from `src/components/ui/card.tsx`
- `DialogTrigger`, `DialogClose`, `DropdownMenuGroup`, etc. from other `src/components/ui/` files
- `createUndoEntry`, `generateGroupId`, `isActionEntry` from `src/modules/Command/models/UndoEntry.ts`
- Most `…Dependencies` helper objects (DI dependency maps)

#### Overbroad `ignore` of components — FIXED
The blanket `"ignore": ["src/components/**/*.tsx"]` was removed. Knip now fully analyzes `src/components/`, which increased the unused-export count from 86 to 92. These additional findings are legitimate dead code.

#### Dynamic imports — FIXED
`@tauri-apps/plugin-fs` is correctly traced by knip (both static and dynamic `import()`). Removed from `ignoreDependencies`.

#### Stale ignore entries — FIXED
All 8 stale paths were removed from `ignore`. The array is now empty.

#### ESLint plugin dependency — FIXED
`@typescript-eslint/eslint-plugin` is detected via `eslint.config.mjs`. Removed from `ignoreDependencies`.

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
- `@types/sinon` — types for unused `sinon`.

**Note:** `ts-morph` and `@types/jscodeshift` are no longer flagged because `codemods/*.ts` was added to `entry`. `ts-morph` is used in `codemods/remove-inject-dependencies.ts`.

### 3. Unfinished / unwired legitimate features (do not delete)

#### Empty module event barrels (~15 modules)
Files like `src/modules/AiGeneration/events/index.ts`, `src/modules/CrdtDocument/events/index.ts`, `src/modules/Bacteria/events/index.ts` contain only a comment (`// no public events`). These are **architectural placeholders** following the repo's DDD module convention. Every module is expected to expose an `events/index.ts` public contract; when a module has no domain events, the file is intentionally left as a stub. **Do not remove** without changing the architectural convention.

#### Feature directories with stores but unwired useCases
Several substantial features have fully implemented stores and use-case directories, but the useCases are not imported by any handler or view:

| Feature | Store exists | UseCases exist | Wired? | Notes |
|---------|-------------|----------------|--------|-------|
| Control Room | `src/modules/AudioEngine/stores/controlRoom.ts` | `src/modules/AudioEngine/useCases/controlRoom/` | Partial | **CORRECTION (2026-04-20):** `toggleMono` and `toggleDim` are wired via `handleToggleControlRoomMono`/`handleToggleControlRoomDim` in `src/modules/Arrangement/handlers/newFeature/`. The remaining useCases (`toggleTalkback`, `setTalkbackLevel`, `createCueMix`, `deleteCueMix`, `addMonitor`, `switchMonitor`, `setCueTrackLevel`, `calibrateMonitor`, `setMonitorVolume`, `setDimLevel`, `getEffectiveVolume`, `toggleMute`, `toggleReference`) are not called outside their own tests. |
| RAVE (AI timbre transfer) | `src/modules/AudioEngine/stores/rave.ts` | `src/modules/AudioEngine/useCases/rave/` | ❌ | Store tested. UseCases for encode/decode/interpolate are complete. |
| Elastic Audio | — | `src/modules/AudioEngine/useCases/elasticAudio/` | ❌ | No store. UseCases for transient detection/quantization exist. |
| Sample Player | — | `src/modules/AudioEngine/useCases/samplePlayer/` | ❌ | No store. UseCases for SFZ playback exist. |
| Loop Station | `src/modules/Transport/stores/loopStationStore.ts` | `src/modules/Transport/useCases/loopStation/` | ❌ | Store tested. UseCases for slot CRUD exist. |
| Punch Recording | `src/modules/Transport/stores/punchRecordingStore.ts` | `src/modules/Transport/useCases/punchRecording/` | ❌ | Store tested. UseCases for pre/post roll, background capture exist. |
| Setlist | `src/modules/Transport/stores/setlistStore.ts` | `src/modules/Transport/useCases/setlist/` | ❌ | Store tested. UseCases for item CRUD/reordering exist. |
| DAWproject import/export | — | `src/modules/Project/useCases/dawProject/` | Partial | `exportDawProject` action and handler exist, but the underlying `parseDawProject.ts` / `exportDawProject.ts` useCases are not called by the handler. |
| Music Mentor | — | `src/modules/AiRuntime/useCases/musicMentor/` | Partial | **CORRECTION (2026-04-20):** `handleGetMentorTips` does call `generateMentorLessons()` from the module's useCases index. What is actually unwired is `queries.ts` in the `musicMentor/` directory — verify whether those query helpers have any consumer outside the `__tests__/queries.spec.ts` file. |
| Modulation System | `src/modules/Automation/stores/modulationStore.ts` | `src/modules/Automation/useCases/modulation/` | Partial | **CORRECTION (2026-04-20):** Lives under `src/modules/Automation/`, not `Plugin/`; store + model + `applyModulation` tick-hook exist, but CRUD use-cases for modulators/mappings and audio-path dispatch (engine write-through) were missing and have since been added in this session. |
| Node View | `src/modules/Plugin/stores/nodeView.ts` | `src/modules/Plugin/useCases/nodeView/` | ❌ | Store and useCases for graph editor exist. |
| Push Integration | `src/modules/Plugin/stores/push.ts` | `src/modules/Plugin/useCases/pushIntegration/` | ❌ | Ableton Push 2 support. Store and useCases present. |

These are **intentionally built but not yet shipped features**. Deleting them would destroy legitimate product work.

#### Extension system (frozen)
`src/modules/Extension/stores/extension.ts` contains an explicit comment:
> TODO: FROZEN — Extension system is architecturally sound (types, manifest, store) but execution runtime is unsafe (new Function).

All extension useCases (`installExtension`, `toggleExtension`, `executeCommand`, etc.) are flagged as unused. This is correct — the feature is deliberately disabled — but the code should be preserved until the sandboxing issue is resolved.

#### Adjustment Layer system
`src/modules/Arrangement/useCases/adjustmentLayer/` contains 9 use-case files. This appears to be an unfinished feature (adjustment regions for non-destructive editing).

> **CORRECTION (2026-04-20):** A store exists at `src/modules/Arrangement/stores/adjustmentLayer.ts` (exported via `stores/index.ts`), and `handleCreateAdjustmentLayer` in `src/modules/Arrangement/handlers/batchFeature/` wires `createAdjustmentLayer`. The other 8 useCases (`addAdjustmentRegion`, `removeAdjustmentRegion`, `removeAdjustmentLayer`, `toggleAdjustmentLayer`, `setLayerParameter`, `setLayerMix`, `getLayerCount`, `getActiveLayersAtBeat`) are unwired. Classify this as **Partial**, not fully orphaned.

#### Automation sub-lanes
`src/modules/Workspace/useCases/automationSubLanes/` (directory with `addAutomationSubLane.ts`, `removeAutomationSubLane.ts`, etc.) has tests but no production consumers.

#### Inspector effect layouts
`src/modules/Workspace/presentations/views/Inspector/layouts/effects/` contains ~16 layout components (`BitcrusherLayout.tsx`, `CompressorLayout.tsx`, etc.). They are not imported anywhere. Likely they are meant to be wired into an effect inspector that is not yet built.

#### Spectrogram view
`src/modules/Plugin/presentations/views/SpectrogramView.tsx` — a visualization component with no consumers.

## Priorities

1. **Fix broken test imports** (10 unresolved imports). These represent real test failures or stale paths after refactoring.
2. **Remove truly unused dependencies** (`@huggingface/transformers`, `sinon`, `@types/sinon`).
3. **Add `glob` to `package.json`** — it is used by `scripts/generate-view-tests.ts` and `codemods/fix-tests.ts` but not declared.
4. **Audit orphaned DI helpers** (`…Dependencies.ts` exports). Many are likely safe to delete if the corresponding use-case no longer uses DI injection.
5. **Document frozen/unfinished features** so future knip runs don't re-investigate the same directories.

## Open issues

1. **Broken test imports exist in 8+ test files.**
   - `src/modules/Crumbs/presentations/components/__tests__/PadGrid.spec.tsx` — wrong model path.
   - `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/__tests__/helpers.spec.ts` — wrong relative depth.
   - `src/modules/Plugin/useCases/__tests__/pluginBrowserActions.spec.ts` — mocks non-existent module.
   - 4 Yeast processor tests — wrong relative depth for `MidiEvent`.
   - 3 tests referencing `#/utils/Logger/Logger` — logger was moved to `infra/logger`.
   - **Needed:** Fix import paths or delete obsolete tests.

2. **`../wasm/workletPolyfill.js` is imported but does not exist in source.**
   - Imported from 9 AudioEngine processor files. Knip no longer reports these as unresolved, but the imports remain in source and may be stale.
   - **Needed:** Determine if this file is generated by the wasm build or if the import is stale.

3. **`glob` is an unlisted dependency.**
   - Used in `scripts/generate-view-tests.ts` and `codemods/fix-tests.ts` but not declared in `package.json`.
   - **Needed:** Add `glob` to `devDependencies` (or `dependencies`).

4. **Unused dependencies remain in `package.json`.**
   - `@huggingface/transformers` — verified: only mentioned in a code comment, no actual import.
   - `sinon`, `@types/sinon` — verified: not imported anywhere in the codebase.
   - **Needed:** Remove them.

## Open questions

- Are the inspector effect layouts (`src/modules/Workspace/presentations/views/Inspector/layouts/effects/`) intended to be wired soon, or are they abandoned? No store or registry imports them.
- ~~Is the `workletPolyfill.js` import a build-time requirement, or can it be removed from the processor sources?~~ **Resolved:** These imports were removed in commit `c2ddccaa`.
- Should empty `events/index.ts` stubs be kept as a convention, or should the convention change to omit the file when a module has no events?
- Are the `…Dependencies.ts` DI helper files still required by the current DI system, or has the project moved to a different injection pattern (e.g., `createHandler` with inline deps)?
- Why does knip treat files with companion test files (`.spec.ts` in the same directory or `__tests__/*.spec.ts`) as used even when test files are excluded from `project`? This behavior was discovered during adversarial review and cannot be disabled via the Vitest or Vite plugins.

## Risks

- **Test rot:** Broken test imports suggest tests are not being run in CI or are silently skipped. This erodes confidence in the test suite.
- **Dependency bloat:** `@huggingface/transformers` is a large package. Keeping unused dependencies increases install time and bundle analysis noise.
- **False confidence in knip:** With ~90 unused files reported, most of which are legitimate unfinished features, developers may ignore knip output entirely, causing real dead code to accumulate.
- **Accidental deletion:** Without clear documentation, a future session running knip might delete unfinished features (e.g., loop station, punch recording, setlist) believing them to be dead code.

## Suggested approaches

1. **Fix broken test imports.**
   - Run `pnpm test:run` to see which tests actually fail.
   - Fix or delete tests with stale imports.

2. **Clean up `package.json` dependencies.**
   - Add `glob` to `devDependencies`.
   - Remove `@huggingface/transformers`, `sinon`, `@types/sinon`.

3. **Document frozen features.**
   - Add a `knip.md` or inline comments in `knip.json` explaining why `src/modules/Extension/useCases/extension/` and other frozen directories are intentionally unwired.

4. **Remove confirmed dead code.**
   - Delete orphaned exports like `STANDARD_FREQ_MARKS`, `classifyDso`, `deleteEnvelope` after confirming no dynamic/string-based imports exist.

## Knip config assessment (2026-04-20)

Reviewed `knip.json` against the knip v6 feature set and this project's actual structure. **Verdict: tip-top, with two small optional tightenings.**

What is correct:
- `entry` covers `src/routes/**/*.tsx`, `scripts/*.ts`, `codemods/*.ts`. The Vite entry (`src/app/main.tsx`) is auto-detected via `index.html`. Workers loaded with `new Worker(new URL(...))` and `?worker` imports are traced by knip v6.
- `project` excludes spec/test files and `routeTree.gen.ts` — matches the project policy that tests should not create export usages.
- `ignoreExportsUsedInFile: true` suppresses intra-file false positives.
- `ignoreDependencies: ["tailwindcss"]` is necessary — tailwindcss is consumed via the vite plugin and CSS, not module imports.
- `ignoreBinaries: ["prettier", "wasm-pack"]` is correct — `prettier` enters via `eslint-plugin-prettier` at runtime and `wasm-pack` is an external Rust tool.
- Vite, Vitest, TanStack Router, ESLint, and TypeScript plugins auto-activate via `vite.config.ts`, `eslint.config.mjs`, `tsconfig.json` — nothing to configure manually.

Minor optional improvements (non-blocking):
- **`entry` could also include `scripts/*.{mjs,cjs}`** (`fix-hoisted.mjs`, `finalize_task.mjs`, `scripts/generate-view-tests.cjs`, etc.) if you want knip to trace their imports. These are one-off maintenance scripts today, so skipping them is defensible — just document the choice.
- **`ignore` is `[]`**, which is the correct baseline. If the frozen `Extension` system or other deliberately-unwired features grow noisy, consider adding them with comments rather than re-adding blanket `src/components/**` style suppressions.
- **Companion-test-file heuristic (knip v6.3.1):** knip treats source files with a neighbouring `.spec.ts` as "used" even when tests are excluded from `project`. This is an upstream limitation, not fixable via config. It does hide some real dead code (e.g. `src/components/ui/card.tsx`). Worth pinning in a short `docs/agents/` note so future sessions don't re-discover it.

No changes to `knip.json` are required to address the remaining findings in this audit — the work is all outside the config.

## Recommendation

**Knip configuration is now accurate within the limits of the tool.** The config correctly traces dynamic imports, auto-detects Vite entries, and no longer suppresses components or stale paths. However, knip has an **undocumented companion-test-file heuristic** that treats files with corresponding `.spec.ts` tests as used even when tests are excluded from `project`. This means some genuinely unused files (e.g., `src/components/ui/card.tsx`, `src/modules/Arrangement/useCases/clipGainEnvelope/getAllClipGainEnvelopes.ts`) are not flagged. This limitation is intrinsic to knip v6.3.1 and cannot be disabled via configuration.

The remaining work is to fix the 10 broken test imports, add `glob` to `package.json`, remove the 3 confirmed unused dependencies, and decide which of the ~92 flagged files/exports are dead code versus legitimate unfinished features.

## Resolved

- ~~Stale `knip-results.txt` existed from pre-refactor state~~ — superseded by fresh run on 2026-04-20.
- ~~Missing entry points (`main.tsx`, workers, scripts, codemods)~~ — fixed. `main.tsx` is auto-detected; scripts/codemods added to `entry`.
- ~~Overbroad `src/components/**/*.tsx` ignore~~ — removed.
- ~~Stale `ignore` entries (8 paths)~~ — removed.
- ~~`@tauri-apps/plugin-fs` incorrectly in `ignoreDependencies`~~ — removed; knip traces dynamic imports correctly.
- ~~`@typescript-eslint/eslint-plugin` incorrectly in `ignoreDependencies`~~ — removed; knip detects it via `eslint.fast.config.mjs`.
- ~~`workletPolyfill.js` unresolved imports~~ — superseded by commit `c2ddccaa` which removed all such imports from source.

### Fixed in this session (2026-04-20, audit cleanup pass)

- ~~10 broken test imports (unresolved)~~ — all fixed. `#/utils/Logger/Logger` → `#/infra/logger/types` (3 files); `PadGrid.spec.tsx` `SamplerTypes` → `CrumbsTypes`; GrandBoule `helpers.spec.ts` relative depth corrected; 4 Yeast processor specs `../../models/MidiEvent` → `../../../models/MidiEvent`; `pluginBrowserActions.spec.ts` — stale `DeviceBrowser` mock removed (the module doesn't exist and the test doesn't need it). All 10 tests now pass.
- ~~Unused `@huggingface/transformers` dependency~~ — removed.
- ~~Unused `sinon` and `@types/sinon` devDependencies~~ — removed.
- ~~Unlisted `glob` dependency~~ — added as `glob@^13.0.6` to `devDependencies`.
- ~~Truly unused exports~~ — `STANDARD_FREQ_MARKS`, `STANDARD_DB_MARKS`, `classifyDso`, `deleteEnvelope`, `WEBLLM_MODEL_INFO`, `getWebLlmModelById` removed along with their re-exports in `useCases/index.ts` and `aiRuntimeQueries/helpers.ts`.
- ~~Orphaned `…Dependencies` / `…Deps` helpers (in-file)~~ — 15 in-file exports removed: `copySelectedNotesDependencies`, `addGainEnvelopePointDeps`, `toggleClipGainEnvelopeDeps`, `initTimelineRendererDependencies`, `beginClipDragDependencies`, `hitTestAutomationSubLaneDependencies`, `hitTestClipEdgeDependencies`, `snapToGridOrClipsDependencies`, `setVcaGainDependencies`, `insertPolyphonicMidiNotesDependencies`, `playAuditionNoteDependencies`, `initializeAudioEngineDependencies`, `thinAutomationPointsDependencies`, `handleCrumbsFileDropDependencies`, `exportPatternToTimelineDependencies`, `getToasterControlsDependencies`, `trigger16LevelDependencies`, `triggerToasterPadDependencies`, `scheduleMetronomeDependencies`. All are remnants of the old DI-via-object-literal pattern. Typecheck and full test suite (4929 tests) pass.

### Counts after this session

- Unused files: 92 → 92 (unchanged — whole-file deletions out of scope per repo safety rule)
- Unused exports: 92 → 67
- Unused exported types: 22 → 22 (deferred — see Next steps)
- Unused dependencies: 1 → 0
- Unused devDependencies: 2 → 0
- Unlisted dependencies: 2 → 0
- Unresolved imports: 10 → 0
- Configuration hints: 1 (generic "92 unused files" note; knip's companion-test-file heuristic — see below)

## Next steps (deferred, require explicit approval)

1. **Standalone `…Dependencies.ts` files** — 16 files are whole-file Dependencies exports with no other content (e.g., `src/modules/AudioEngine/useCases/latencyCompensation/compensation/trackLatencyDependencies.ts`, `src/modules/Arrangement/useCases/audioAnalysis/audioToMidiDependencies.ts`). Deleting files requires explicit user approval per the repo safety rule.
2. **Unused exported types (22)** — e.g., `MixAnalysis`, `AppActionType`, `FileEntry`. Types are zero-runtime-cost so pruning is lower priority; needs per-type verification.
3. **Other in-file unused exports (~67 remaining)** — a mix of store setters for unfinished features (e.g., `enter16Levels`/`exit16Levels`/`is16LevelsActive`/`get16LevelsTarget` in Toaster — removing them would reveal the 16-levels feature is stubbed), and some genuine orphans (`RenderProgressIndicator`, `parsePhonemesTxt`, `parsePhonemesJson`). Needs per-symbol judgement call.
4. **Unused files (92)** — many are the `events/index.ts` stubs (intentional architectural placeholders), frozen features, or unfinished feature roots. §3 above enumerates which are intentional.
5. **knip v6.3.1 companion-test-file heuristic** — worth a one-paragraph note in `docs/agents/04-standards.md` so future sessions know some dead code is hidden when `.spec.ts` tests sit next to an unused source file. Upstream limitation; no config fix.
