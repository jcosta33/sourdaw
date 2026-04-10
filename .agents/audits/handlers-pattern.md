# Command handler registries (`handlers/`) — purpose and architecture fit

## Scope

`AppAction` handler maps (`trackHandlers`-style), their **non-contract** placement, **`createHandler`** (`#/helpers/createHandler`), and **`get<Module>Handlers`** use cases for cross-module access (primarily Command).

## Goal

1. Handler maps are **private** to each module (`handlers/`); **not** on `index.ts`.
2. **`createHandler`** is mandatory for each `ActionHandler` value; **`get<Module>Handlers`** builds the map with **direct** `handle…` imports and a typed object literal (no `createHandlers` wrapper).
3. **Cross-module** access only via **`getArrangementHandlers`** (pattern: `get<Module>Handlers`) re-exported from `index.ts`.
4. Architecture docs and `AGENTS.md` describe this without bending “use case” rules.

## Relevant code paths

| Area                                   | Role                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#/helpers/createHandler.ts`           | `createHandler` — builds one `ActionHandler`; map assembly is plain object literals in `get<Module>Handlers` or legacy `*Handlers.ts`.                                      |
| `Command/useCases/commandQueries.ts`   | `ActionHandler`, `HandlerDescribeResult`, `AppAction`.                                                                                                                         |
| `Arrangement/useCases/getArrangementHandlers.ts` | **Contract** use case: merges Arrangement handler maps for `executeAppAction`.                                                                                         |
| `Arrangement/useCases/*Handlers.ts`      | Legacy location for handler maps (migrate to `handlers/`).                                                                                                                     |
| `Arrangement/useCases/stretchHandlers.ts` | Reference implementation using `createHandler` + plain handler map object.                                                                                                |
| `Command/useCases/executeAppAction.ts` | `...getArrangementHandlers()` in registry.                                                                                                                                     |
| `docs/architecture/03-typescript-module.md` §4.5 | Formal definition of handlers.                                                                                                                                          |
| `AGENTS.md`                            | Private `handlers/`, helpers, `get<Module>Handlers` rule.                                                                                                                      |

## Current behavior

1. **Typed actions** — `AppAction` union in `commandQueries.ts`.
2. **Dispatch** — `executeAppAction` merges `getArrangementHandlers()` with other modules’ handler sources.
3. **Helpers** — `createHandler<'muteTrack'>({ execute, describe, undoable })` builds each entry; the registry is a typed object literal (no **`createHandlers`** — removed).
4. **Arrangement index** — exports **`getArrangementHandlers` only**; individual `trackHandlers`, `clipHandlers`, etc. are **no longer** public.
5. **Migration** — Remaining `*Handlers.ts` files should adopt `createHandler` and eventually move under **`handlers/`**; **`get<Module>Handlers`** should import each `handle…` directly.

## Findings

1. **Registry indirection remains load-bearing** — Command still needs a merged map per domain; **`get<Module>Handlers`** is the narrow contract.
2. **`handlers/` is enforced as private** — `module-index-contract` + `AGENTS.md` forbid `index.ts` importing `handlers/`; handler maps are not barrel exports.
3. **One function per file** applies to **`getArrangementHandlers.ts`** and to each granular use case; multi-export handler **maps** are confined to non-contract files.

## Priorities

1. Migrate remaining Arrangement `*Handlers.ts` entries to **`createHandler`** (remove `satisfies` noise).
2. Move handler files from `useCases/` to **`handlers/`** per module.
3. Add **`getTransportHandlers`**, **`getWorkspaceHandlers`**, etc., mirroring Arrangement; shrink direct handler exports from other module indexes the same way.

## Open issues

1. **None remaining for the original handler-pattern migration.** Every module now uses **`createHandler`** + **`handlers/<area>/handle*.ts`** + typed **`get*Handlers`** factory; **`executeAppAction`** has zero inline maps.
2. **Tests** import `execute*` from relative `*Handlers` paths — still valid intra-module.

## Open questions

- Codegen for `handlerRegistry` keys vs `AppAction['type']` — optional hardening.

## Risks

- **Drift:** New handler entries added without `createHandler` — catch in review until lint rule exists.

## Suggested approaches

- Roll **`get<Module>Handlers`** + **`createHandler`** across modules.
- Optional ESLint: enforce imports of `createHandler` from handler files.

## Recommendation

**Done across the entire codebase.** All modules use `createHandler` + `handlers/<area>/handle*.ts` + typed `get<Module>Handlers`. `executeAppAction.ts` is import + spread only — zero inline maps. Optional ESLint hardening listed under **Next agent** below.

## Resolved

- **`HandlerDescribeResult`** exported from Command for helper typing.
- **`#/helpers/createHandler`** — single helper for `ActionHandler` construction; registry maps are **plain object literals** with **direct** `handle…` imports in **`get<Module>Handlers`** (see Collaboration, AiGeneration `getAiMidiHandlers`).
- **Typed domain maps** — e.g. **`GenerationHandlersMap`** / **`AiMidiHandlersMap`**: `Extract<AppAction, …>` unions + mapped `{ [Action in … as Action['type']]: ActionHandler<Action> }` instead of `Record<string, ActionHandler<any>>` where the action set is fixed (documented in **`architecture-violations`** §6.6).
- **`getArrangementHandlers`** is the sole Arrangement barrel export for handler maps; **`stretchHandlers`** refactored to use helpers.
- **`docs/architecture/03-typescript-module.md` §4.5** — handlers (non-contract), helpers, `get<Module>Handlers`.
- **`AGENTS.md`** — `handlers/` private, helpers, access rule.
- **`.dependency-cruiser.cjs`** — comment lists `handlers/` as forbidden from `index.ts` imports.
- **Module barrel `get*Handlers` only** — Collaboration, Plugin, AiRuntime (org), AudioAnalysis, Automation, AiGeneration (generation + AI MIDI), **Transport**, Arrangement, **Project** (`getSongStructureHandlers` + `getVersionControlHandlers`), **MIDI** (`getChordTrackHandlers` + `getPatternInstanceHandlers`). **`executeAppAction`** calls **`get*`** factories for those modules.
- **Per-handle files under `handlers/<area>/handle*.ts`** — AudioAnalysis (`analysis/`), Plugin (`pluginHost/`), Automation (`automation/`), AiRuntime (`aiOrganization/`), Transport (`transport/` — 19 handles), Project (`songStructure/`, `versionControl/`), MIDI (`chordTrack/`, `patternInstance/`). Same-module use cases imported via **relative** paths from `handlers/<area>/` → `../../useCases/...` to avoid `#/modules/SameModule` barrel cycles.

---

## Learnings (2026 — handler cleanup pass)

1. **`createHandlers`** — Removed project-wide. Map assembly is a **plain typed object**; no extra wrapper around the record.
2. **`inject` in handler `execute`** — Removed from handler modules touched in this pass; **`execute`** calls imported use-case functions directly (e.g. `setTempo`, `analyzeMix` from relative paths). Tests that relied on **`injectDependencies(executeX, …)`** were rewritten to **`vi.mock`** on the underlying modules (or **`handleX.execute`** with mocks).
3. **Forbidden map-in-useCase pattern (still present in places)** — A file under **`useCases/*Handlers.ts`** that both defines **`handle…`** with **`createHandler`** **and** exports a second symbol **`fooHandlers`** (object map) **only** so **`getFooHandlers`** can `return { …fooHandlers }` or `spread` it is **redundant** and violates the “handlers in `handlers/`, use case only merges” rule. **Example:** `AudioAnalysis/useCases/analysisHandlers.ts` ends with `export const analysisHandlers = { analyzeMix, autoFixMix }` while **`getAnalysisHandlers.ts`** imports that map and re-exports — **no value**; the merge should live **only** in **`getAnalysisHandlers`** with **direct** imports from **`handlers/analysis/handleAnalyzeMix.ts`** (etc.), and **no** exported **`analysisHandlers`** map from `useCases/`.
4. **Collaboration** — Split to **`handlers/collaboration/handle*.ts`**; **`getCollaborationHandlers`** imports those handles directly (reference shape for other modules).

---

## Current status (stop point for handoff)

| Area | Status |
| ---- | ------ |
| **`#/helpers/createHandler`** | In use; **`createHandlers`** deleted. |
| **`inject` in many handler files** | Inlined for Collaboration handles, Plugin host, Transport, Automation, Analysis, AiRuntime org, MIDI chord + pattern, Project song + version, etc. |
| **AudioAnalysis** | **Done.** `handleAnalyzeMix`/`handleAutoFixMix` under `handlers/analysis/`; `getAnalysisHandlers` imports them directly; old `useCases/analysisHandlers.ts` deleted. |
| **Plugin** | **Done.** `handleScanPlugins`/`handleLoadExternalPlugin` under `handlers/pluginHost/`; old `useCases/pluginHostHandlers.ts` deleted. |
| **Automation** | **Done.** Six handles under `handlers/automation/`; old `useCases/automationHandlers.ts` deleted. |
| **Transport** | **Done.** Nineteen handles under `handlers/transport/`; old `useCases/transportHandlers.ts` deleted. |
| **AiRuntime (org)** | **Done.** `handleAutoOrganizeProject` under `handlers/aiOrganization/`; old `useCases/aiOrganizationHandlers.ts` deleted. |
| **Project** | **Done.** `handleDetectSongStructure` under `handlers/songStructure/`; three version-control handles under `handlers/versionControl/`; new `getSongStructureHandlers`/`getVersionControlHandlers` factories; `Project/index.ts` and `executeAppAction.ts` updated; old `useCases/songStructureHandlers.ts`, `useCases/versionControlHandlers.ts` (+ specs) deleted. The pre-existing broken `songStructureHandlers.spec.ts` (using removed `executeX`/`injectDependencies` pattern) was rewritten as `vi.mock`+`handle.execute`. |
| **MIDI** | **Done.** Four chord-track handles under `handlers/chordTrack/`; two pattern-instance handles under `handlers/patternInstance/`; new `getChordTrackHandlers`/`getPatternInstanceHandlers` factories; `MIDI/index.ts` and `executeAppAction.ts` updated; old `useCases/chordTrackHandlers.ts`, `useCases/patternInstanceHandlers.ts` (+ specs) deleted. The pre-existing broken `patternInstanceHandlers.spec.ts` was rewritten as `vi.mock`+`handle.execute`. |
| **Workspace** | **Done.** 34 workspace handles under `handlers/workspace/` + 4 scratch-pad handles under `handlers/scratchPad/`; new `getWorkspaceHandlers` / `getScratchPadHandlers` factories; old `useCases/workspaceHandlers.ts`, `useCases/scratchPadHandlers.ts` (+ specs) deleted. All `inject(...)` wrappers removed; per Learning #2 the handlers call use cases directly. The old `workspaceHandlers.spec.ts` was rewritten as `vi.mock` + `handleX.execute(...)`. |
| **AudioEngine** | **Done.** 13 final-feature handles under `handlers/finalFeature/`; new `getFinalFeatureHandlers` factory; old `useCases/finalFeatureHandlers.ts` (+ spec) deleted. All `inject(...)` removed. |
| **Command (inline maps)** | **Done.** Inline maps in `executeAppAction.ts` redistributed to their natural home modules: `trackAlternativeHandlers` (4) + `templateHandlers` (3) + `vcaHandlers` (4) → **Arrangement** (`handlers/{trackAlternative,template,vca}/`), all merged into `getArrangementHandlers`; `midiRoutingHandlers` (2) → **MIDI** (`handlers/midiRouting/`) via new `getMidiRoutingHandlers`; `dsoSnapshotHandlers` (1) → **CrdtDocument** (`handlers/snapshot/`) via new `getDsoSnapshotHandlers`. The previously cross-cutting `Command/useCases/trackAlternativeHandlers.ts` was deleted. **`Workspace/.../TrackAlternativesSection.tsx`** was updated to dispatch via `executeAppAction` instead of calling the bare `handleX` symbols (architecturally correct — UI dispatches actions, doesn't bypass undo). |
| **Command (own handles)** | **Done.** `macroHandlers` (4) and `undoTreeHandlers` (2) moved to **`Command/handlers/{macro,undoTree}/`**; new `getMacroHandlers` / `getUndoTreeHandlers` factories in `Command/useCases/`; old `useCases/macroHandlers.ts`, `useCases/undoTreeHandlers.ts` (+ specs) deleted. |
| **`executeAppAction.ts`** | Now contains **zero** inline handler maps. Imports + spreads only. |
| **Tests** | All new `handlers/<area>/handle*.spec.ts` pass (18 tests across 11 files cumulatively). Pre-existing failures in `projectPersistence/helpers.spec.ts`, `recentProjects.spec.ts`, `demoUtils.spec.ts`, `Arrangement/useCases/{deviceHandlers,presetHandlers,getPlatformPlugins}.spec.ts`, `Arrangement/presentations/views/TimelineEmptyMenu.spec.tsx`, `Arrangement/presentations/views/TrackHeader/InputSelector.spec.tsx`, AiRuntime view specs, `UndoHistoryPanel.spec.tsx`, `RecentProjectsMenu.spec.tsx`, and `Transport/useCases/transportControls/{stop,pause}Playback.spec.ts` exist on `main` independently of this work — verified by `git stash`. |
| **Docs** | **`03-typescript-module.md` §4.5** updated earlier; **`handlers-pattern.md`** updated this pass. |

---

## Next agent — recommended order

The handler-pattern migration is **complete**. Every module that dispatches `AppAction`s now follows the canonical shape:

1. `handlers/<area>/handleX.ts` — one `createHandler<'actionType'>` per file (no `inject(...)`, no `executeX` aliases).
2. `useCases/get<Area>Handlers.ts` — typed `get*Handlers` factory + `*HandlersMap` mapped union; imports `handle*` directly.
3. `index.ts` exports **only** the `get*Handlers` factory (and types) for handler registries — never raw `*Handlers` maps.
4. `Command/useCases/executeAppAction.ts` is **import + spread only** — zero inline handler maps.

Optional follow-ups (not blocking):

1. **ESLint rule** — forbid `export const \w+Handlers\b\s*=` in `useCases/` and require `get*Handlers.ts` to only import from `../handlers/`. This would catch any future regression.
2. **Optional ESLint** — forbid `inject(...)` inside files under `handlers/` (per Learning #2; handlers should call use cases directly).
3. **Forbid direct `handle*` imports from views** — add a rule that `handlers/` cannot be imported by `presentations/`. UI should always go through `executeAppAction`. The `TrackAlternativesSection.tsx` violation found during this pass is fixed.
4. **Codegen** — `handlerRegistry` keys vs `AppAction['type']` exhaustiveness check.

### Notes / gotchas observed during the 2026-04 pass

- **Same-module relative imports.** Files under `handlers/<area>/` should reach into `../../useCases/...` rather than going through `#/modules/SameModule` to avoid barrel re-entry cycles. The barrel for the module **may not** import `handlers/` (enforced by `module-index-contract` + `dependency-cruiser`).
- **`get*Handlers` lives in `useCases/`** — it is a *use case* (cross-module contract surface), not part of `handlers/`. Only the typed `get*Handlers` is exported from `index.ts`; the typed `*HandlersMap` type lives next to it.
- **Test moves.** When relocating a handler spec from `useCases/*Handlers.spec.ts` to `handlers/<area>/handleX.spec.ts`, the `vi.mock` paths need to be rewritten (most go from `'./xxx'` to `'../../useCases/xxx'`). A handful of pre-existing specs (`songStructureHandlers.spec.ts`, `patternInstanceHandlers.spec.ts`, `workspaceHandlers.spec.ts`, `macroHandlers.spec.ts`, `undoTreeHandlers.spec.ts`, `trackAlternativeHandlers.spec.ts`) referenced an `execute*` symbol + `injectDependencies` test pattern that no longer exists; rewrite them as `vi.mock` + `handle.execute({ type, payload })`.
- **`executeAppAction.ts` imports.** Update both the import line *and* the spread inside `getHandlerRegistry()`. Easy to miss one.
- **`Workspace/index.ts` `defaultWorkspaceState` location.** Unrelated state-shape work may also be in flight (`workspaceStore.ts` / `workspaceQueries.ts` was modified outside this audit's scope) — leave it alone unless it conflicts with handler moves.
- **Cross-module handle redistribution.** Inline handler maps that reference another module's APIs (`templateHandlers`, `vcaHandlers`, `trackAlternativeHandlers`, `midiRoutingHandlers`, `dsoSnapshotHandlers`) should go in the natural home module, not Command. The exception is **Command-genuine** handles like `macro` and `undoTree` — those legitimately live in `Command/handlers/`.
- **`createHandler` vs raw object literal.** `createHandler<'actionType'>({ execute, describe, undoable })` is the only allowed shape. Raw `{...} satisfies ActionHandler<...>` literals are non-compliant.
- **UI must dispatch via `executeAppAction`.** Any view that calls `handleX(action)` directly is wrong — it bypasses undo, history, semantic context, and macro recording. Convert to `executeAppAction({ type: 'actionType', payload: {...} })`.
- **Pre-existing test failures.** `pausePlayback.spec.ts` / `stopPlayback.spec.ts` (Transport), `projectPersistence/helpers.spec.ts`, `demoUtils.spec.ts`, `recentProjects.spec.ts`, `Arrangement/useCases/{deviceHandlers,presetHandlers,getPlatformPlugins}.spec.ts`, `Arrangement/presentations/views/TimelineEmptyMenu.spec.tsx`, `Arrangement/presentations/views/TrackHeader/InputSelector.spec.tsx`, several view specs in AiRuntime / Command / Project all fail on `main` independent of this work — do not waste time on them while doing handler refactors.
