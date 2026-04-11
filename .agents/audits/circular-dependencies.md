# Circular dependencies audit

## Scope

The static module-import graph under `src/`. Specifically: file-to-file circular import chains within individual modules. Cross-module circularity is **not** in scope — `pnpm deps:validate` already enforces module boundaries via `.dependency-cruiser.cjs`, and the cycles found are all intra-module.

Excluded:

- Runtime cycles that resolve through `inject()` lazy resolution.
- Cross-module barrel imports (covered by `architecture-violations.md`).
- Type-only re-export laundering through `index.ts` (covered by `index-ts-boundary-audit.md`).

## Goal

Zero circular dependencies in the TypeScript graph under `src/`, enforced going forward by a `no-circular` rule in `.dependency-cruiser.cjs`. Each fix must be **semantic** compliance per the `architecture-violations` skill — i.e. the responsibility of each file becomes clearer, not just the import path. Fake compliance (extracting a `Types.ts` sibling that exists only to break the cycle without changing responsibilities) is explicitly disallowed.

## Relevant code paths

- `.dependency-cruiser.cjs` — currently enforces module-boundary rules but **has no `no-circular` rule**, so cycles slip through `pnpm deps:validate`.
- `docs/architecture/03-typescript-module.md` §4.1 (`models/`), §4.4 (`useCases/`), §4.6 (`stores/`), §4.8 (`services/`), §4.11 (`inject()`).
- `.agents/skills/architecture-violations/SKILL.md` §4 (semantic vs cosmetic compliance), §6.5 (one-function-per-file).
- `.agents/skills/state-and-write-paths/SKILL.md` (state ownership; stores expose, useCases write).
- `.agents/audits/handlers-pattern.md` §133 (same-module relative imports to avoid barrel re-entry).
- `.agents/audits/inject-orchestration-opportunities.md` §156–158 (precedent: `analysisHandlers` / `autoFixMix` use `inject({ executeAppAction })` to break re-entrant cycles).
- Cycle hubs:
  - `src/modules/AiRuntime/models/MidiPatternLibrary.ts` and `models/Patterns/`
  - `src/modules/Arrangement/models/DeviceParameter.ts` and `models/PluginDescriptors/`
  - `src/modules/Command/models/CommandRegistry.ts` and `models/Commands/`
  - `src/modules/{Arrangement,Collaboration,Command,Transport,Workspace}/stores/*Store.ts` and their paired use-case files
  - `src/modules/Command/useCases/macro/playback.ts`, `executeAppAction.ts`, `getMacroHandlers.ts`, `handlers/macro/handlePlayMacro.ts`
  - `src/modules/Workspace/presentations/views/Sidebar.tsx` and `Sidebar/{EffectsTab,InstrumentsTab}.tsx`
  - `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts` and `wamPluginHost/hostOperations.ts`

## Current behavior

`pnpm deps:validate` reports zero violations. `npx madge --circular --extensions ts,tsx src` reports **38 circular dependencies**, all intra-module. They cluster into 5 distinct structural patterns.

### Pattern A — Hub aggregator owns the shared types its spokes need (29 cycles)

| Hub | Spokes | Cycle count |
|---|---|---|
| `AiRuntime/models/MidiPatternLibrary.ts` | `models/Patterns/{Bass,Chord,Drum,Melody}Patterns.ts` | 4 |
| `Arrangement/models/DeviceParameter.ts` | `models/PluginDescriptors/*.ts` (15 files) | 15 |
| `Command/models/CommandRegistry.ts` | `models/Commands/*.ts` (10 files) | 10 |

Each hub does three jobs in one file:

1. Defines the shared type(s) — `PatternTemplate`, `PluginDescriptor`, `CommandEntry`.
2. Owns helper functions — `getScalePitches`, `chordFromDegrees`, `filterTemplates`, `fuzzyMatch`, `searchCommands`, `isDeviceSupportedOnCurrentPlatform`, the synth/drum variant builders.
3. Imports every spoke and aggregates them into one constant array (`PATTERN_TEMPLATES`, `BUILTIN_PLUGINS`, `commandRegistry`).

Spokes import the type from the hub → `hub → spoke → hub` cycle on every spoke.

Representative:

- `MidiPatternLibrary.ts:201–204` imports `bassPatterns` etc.
- `Patterns/BassPatterns.ts:1` imports `PatternTemplate`, `PatternNote`, `getScalePitches`, `KEY_SEMITONES` from `../MidiPatternLibrary`.

### Pattern B — Store ↔ useCase state-shape type (5 cycles)

| Store | useCase the store imports a shape from | Symbol |
|---|---|---|
| `Arrangement/stores/scratchPadStore.ts:2` | `useCases/scratchPad/scratchPadCrud.ts:5` | `ScratchPadSection` |
| `Collaboration/stores/collaborationStore.ts:3` | `useCases/collaborationQueries.ts` | `CollaborationState` |
| `Command/stores/macroStore.ts:3` | `useCases/macro/recording.ts` | `Macro` |
| `Transport/stores/transportStore.ts:4` | `useCases/transportQueries.ts` | `TransportState`, `defaultTransportState` |
| `Workspace/stores/workspaceStore.ts` | `useCases/workspaceQueries.ts` | `WorkspaceState` |

State **shape** is defined inside `useCases/`, but the store needs the type for `createStore<T>`. Use cases also read/write the store value → cycle. This is the inversion `state-and-write-paths` warns against: the use case expresses **intent**, the store exposes **state**, and the model defines the **shape**. Putting the shape in the use case file conflates two roles.

The Transport and Workspace cycles also route through `repositories/` (3-node cycles) for the same reason — repositories import the shape from the same use-case file.

### Pattern C — Macro handler chain (1 cycle, 4 files)

```
handlers/macro/handlePlayMacro.ts
  → useCases/macro/playback.ts
    → useCases/executeAppAction.ts (statically imports getMacroHandlers)
      → useCases/getMacroHandlers.ts (statically imports handlePlayMacro)
        → handlers/macro/handlePlayMacro.ts
```

`useCases/macro/playback.ts:21` already does `await import('../executeAppAction')` to dodge the inner cycle, but the outer cycle still exists at module-load time because `executeAppAction` statically imports `getMacroHandlers`, which statically imports `handlePlayMacro`, which statically imports `playback`. A single dynamic-import edge does not break a static cycle on the other three edges; the file comment in `executeAppAction.ts:26–29` already acknowledges this by lazy-building the registry.

### Pattern D — Sibling tab files import the parent view for a route type (2 cycles)

- `Workspace/presentations/views/Sidebar/EffectsTab.tsx:49` imports `type SidebarRoute` from `'../Sidebar'`
- `Workspace/presentations/views/Sidebar/InstrumentsTab.tsx:36` imports the same type
- `Sidebar.tsx:13–14` imports both tab components

The route type lives in the parent view; tab children need it. Same shape problem as Pattern A but in the presentation layer.

### Pattern E — Plugin host ↔ Faust compiler (1 cycle)

- `Plugin/useCases/faustEngine/compilerEngine.ts:23` statically imports `registerWAMPlugin` and `WAMDescriptor` from `../wamPluginHost/hostOperations`
- `Plugin/useCases/wamPluginHost/hostOperations.ts:41` does `await import('../faustEngine/compilerEngine')` inside `loadWAMPlugin` for the `faust.` id-prefix branch

Same dynamic-on-one-edge-static-on-the-other problem as Pattern C, but with a deeper layering smell: the low-level WAM host should not know that Faust exists. Faust is one possible plugin source; the host should treat it the same as any other.

## Findings

1. **The cycles are not random — they cluster around four shapes,** each of which has a single architectural cause: type ownership in the wrong layer (A, B, D), static handler-registry walks that re-enter the file that registered them (C), and reverse coupling from a generic host to a specific plugin format (E).

2. **All 29 Pattern A cycles share the same root cause and have the same fix.** They were created by a recent split of monolithic registry files into per-category sub-files (visible in `git status`: the renames from `patterns/` → `Patterns/`, `pluginDescriptors/` → `PluginDescriptors/`, `commands/` → `Commands/`). The split moved the data without moving the type ownership, so the spokes have to import their type from the file that imports them.

3. **Pattern B is the inverse of `state-and-write-paths`.** The skill is explicit: stores expose state, use cases own writes, models define shapes. State-shape types defined inside `useCases/` violate the read/write separation by putting the shape definition on the write side of the boundary.

4. **Pattern C has documented precedent.** `inject-orchestration-opportunities.md` §156–158 mentions `analysisHandlers` / `autoFixMix` as the canonical pattern for handlers that re-enter `executeAppAction`. The macro chain is one of the few places that did not adopt that precedent; it used dynamic import as a workaround instead.

5. **`pnpm deps:validate` is silent on this entire problem class.** `.dependency-cruiser.cjs` has no `no-circular` rule. Without one, cycles will keep accumulating after this audit is closed.

6. **None of the cycles cross a module boundary.** The module-boundary rules in §3.3 are intact. The structural failure is at a layer beneath `index.ts` — *intra*-module file responsibilities.

7. **No fix in this audit requires touching `index.ts` files.** That is significant: it means none of these cycles are caused by the public surface, and fixing them does not risk regressing the boundary work tracked in `index-ts-boundary-audit.md`.

## Priorities

1. **Pattern B** (state shapes → models) — smallest blast radius, no behavior risk, aligns with `state-and-write-paths`. Good warm-up; clears 5 cycles.
2. **Pattern A — `MidiPatternLibrary` first**, then `DeviceParameter`, then `CommandRegistry`. Highest cycle count (29). Mechanical once the first one is done.
3. **Pattern D** (`SidebarRoute` extract). Trivial; clears 2 cycles.
4. **Pattern C** (macro chain via `inject({ executeAppAction })`). Adopts existing precedent.
5. **Pattern E** (plugin loader registry). Smallest by file count but the only fix that's a layering correction rather than a type-extraction.
6. Add the `no-circular` rule to `.dependency-cruiser.cjs` once the count is zero.

## Open issues

### Issue 1 — Pattern A: hub aggregators conflate model types, services, and value catalogs

**Problem.** `MidiPatternLibrary.ts`, `DeviceParameter.ts`, and `CommandRegistry.ts` each contain (a) the shared type used by every spoke, (b) pure helper functions, and (c) the aggregated value catalog. The type-ownership half makes the spokes import upward; the catalog half makes the parent import downward. Cycle.

**Representative files.**

- `src/modules/AiRuntime/models/MidiPatternLibrary.ts:1–245` (244-line hub)
- `src/modules/AiRuntime/models/Patterns/BassPatterns.ts:1` (spoke importing 4 symbols from the hub)
- `src/modules/Arrangement/models/DeviceParameter.ts:1–205`
- `src/modules/Arrangement/models/PluginDescriptors/BacteriaDescriptor.ts:9` (representative spoke)
- `src/modules/Command/models/CommandRegistry.ts:1–69`
- `src/modules/Command/models/Commands/TransportCommands.ts:1` (representative spoke)

**Needed.** Split each hub along the **model vs service** seam (per §4.1 / §4.8 of `03-typescript-module.md`):

- A new file in `models/` containing only the type and any pure data tables (key/scale tables, scale intervals, label maps).
- A new file in `services/` containing only the helper functions (`getScalePitches`, `chordFromDegrees`, `filterTemplates`, `fuzzyMatch`, `searchCommands`, the synth/drum variant builders, `isDeviceSupportedOnCurrentPlatform`).
- The original hub file shrinks to **only** the aggregation: `export const PATTERN_TEMPLATES = [...spokes]`. It keeps its name so existing same-module callers do not move.
- Spokes import the type from the new model file, never from the aggregator.

### Issue 2 — Pattern B: state-shape types live inside `useCases/` instead of `models/`

**Problem.** Five stores import a state-shape type from a use-case file. The use case also writes the store. The shape belongs in `models/` per §4.1 and `state-and-write-paths`.

**Representative files.**

- `src/modules/Arrangement/stores/scratchPadStore.ts:2`
- `src/modules/Arrangement/useCases/scratchPad/scratchPadCrud.ts:5–12`
- `src/modules/Collaboration/stores/collaborationStore.ts:3`
- `src/modules/Command/stores/macroStore.ts:3` (also imports `AppAction` from `commandQueries`)
- `src/modules/Transport/stores/transportStore.ts:4`
- `src/modules/Workspace/stores/workspaceStore.ts`

**Needed.** Move each state-shape type (and any default-state constant) from the use-case file into the corresponding `models/` file. For `ScratchPadSection`, consolidate into the existing `models/ScratchPadSection.ts`. Update both the store and the use case to import the shape from `models/`.

### Issue 3 — Pattern C: macro handler chain has a static cycle through `getMacroHandlers`

**Problem.** `executeAppAction.ts` statically imports `getMacroHandlers`, which statically imports `handlePlayMacro`, which statically imports `playback.ts`, which is also imported by `executeAppAction` (via the dynamic `await import` workaround). The cycle is real at module-load even though one edge is dynamic.

**Representative files.**

- `src/modules/Command/handlers/macro/handlePlayMacro.ts:1–11`
- `src/modules/Command/useCases/macro/playback.ts:1–27` (note the `Uses dynamic import to avoid circular dependency` comment)
- `src/modules/Command/useCases/executeAppAction.ts:20` (imports `getMacroHandlers`)
- `src/modules/Command/useCases/getMacroHandlers.ts:3` (imports `handlePlayMacro`)

**Needed.** Convert `playMacro` in `playback.ts` to use `inject({ executeAppAction })(({ executeAppAction }) => async (macroId) => { … })`. Drop the `await import('../executeAppAction')` workaround. This matches the precedent documented in `inject-orchestration-opportunities.md` (§156–158) for `analysisHandlers` / `autoFixMix`.

### Issue 4 — Pattern D: sibling tab files import the parent view for a type

**Problem.** `Sidebar/EffectsTab.tsx` and `Sidebar/InstrumentsTab.tsx` import `type SidebarRoute` from `'../Sidebar'`, while `Sidebar.tsx` imports both tab components. Two cycles.

**Representative files.**

- `src/modules/Workspace/presentations/views/Sidebar.tsx:13–14, 21–29`
- `src/modules/Workspace/presentations/views/Sidebar/EffectsTab.tsx:49`
- `src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx:36`

**Needed.** Extract `SidebarRoute` into `presentations/views/Sidebar/SidebarTypes.ts` (or similar). Both `Sidebar.tsx` and the tab files import from there. Internal organisation under `presentations/views/` is unconstrained by §3.3, so this is a same-module relative-path move only.

### Issue 5 — Pattern E: WAM host knows about Faust

**Problem.** `loadWAMPlugin` in `wamPluginHost/hostOperations.ts` branches on the `faust.` id prefix and dynamic-imports `compilerEngine`. `compilerEngine` already imports `registerWAMPlugin` from `hostOperations`. Static cycle plus a layering violation: the format-agnostic host should not know about a specific plugin format.

**Representative files.**

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:23` (`import { registerWAMPlugin } from '../wamPluginHost/hostOperations'`)
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations.ts:39–42` (`if (pluginId.startsWith('faust.')) { … await import('../faustEngine/compilerEngine') }`)

**Needed.** Introduce a small `pluginLoaderRegistry` (intra-`Plugin` repository or service) that maps id-prefix → loader function. `compilerEngine` registers `'faust.'` against its loader at init; `loadWAMPlugin` uses `inject({ pluginLoaderRegistry })` (or a direct relative import to a module-private singleton) and looks up the loader by prefix. Direction becomes `compilerEngine → registry`, `hostOperations → registry`, with no back-edge.

### Issue 6 — `.dependency-cruiser.cjs` does not enforce `no-circular`

**Problem.** `pnpm deps:validate` returns clean despite 38 cycles. The cruiser config has rules for cross-module boundaries but no `no-circular` rule, so this entire problem class is invisible to CI.

**Representative file.** `.dependency-cruiser.cjs:53–104` (forbidden rules section).

**Needed.** Once the cycle count is zero, add a `no-circular` rule (severity `error`) to the `forbidden` array. This is a CI-config change that needs explicit approval per CLAUDE.md safety rules — do not land it silently.

## Open questions

1. **Pattern A scope: full model/service split vs lighter "types-only sibling"?** The full split is architecturally cleaner and matches §4.1 / §4.8, but it touches more files. The lighter alternative (`MidiPatternTypes.ts` next to `MidiPatternLibrary.ts` containing both types and helpers) breaks the cycles with fewer moves but creates a file whose responsibility is "everything that isn't the aggregator" — borderline cosmetic compliance per the `architecture-violations` skill §4.4.

2. **Pattern E: `inject()` or module-private singleton for the loader registry?** Both work. `inject()` is the canonical DI choice but a singleton `Map` inside `Plugin/services/` is simpler and matches how `hostOperations` already holds its `registry` and `instances` maps (`hostOperations.ts:4–5`).

3. **Should the `no-circular` rule be added incrementally per pattern (bumping the allowed count down) or only at the end?** All-at-once is simpler; incremental gives a per-pattern safety net.

## Risks

- **Leaving the cycles in place.** Cycles cause non-deterministic module-load order, which produces real bugs in this codebase: Vite HMR sometimes evaluates one half of a cycle before the other, causing `undefined` exports at first paint. The macro chain (Pattern C) has already needed a dynamic-import workaround for the same reason.
- **Vitest flakiness.** Modules with circular type dependencies sometimes type-check but fail to evaluate in test runners that hoist mocks aggressively. New tests in `git status` (`Workspace/useCases/getWorkspaceHandlers.spec.ts`, etc.) increase exposure.
- **`inject()` resolution chains throw on cycles** (per §4.11 — "Circular dependencies throw with a chain"). As more use cases adopt `inject()` per `inject-orchestration-opportunities.md`, the existing static cycles will start surfacing as runtime errors. Pattern C is already in this category.
- **Fake compliance on Pattern A.** The lighter "types-only sibling" approach risks creating a non-file that exists only to break the cycle. The audit explicitly flags this so the spec author chooses with eyes open.
- **Audit-thread safety in the audio path.** None of the affected files are in the audio thread, so `no allocation, no locks` rules from CLAUDE.md are not at risk here.

## Suggested approaches

### For Pattern A — model + service split

Each hub becomes three files instead of one. The aggregator file keeps its current path and name so external callers do not move; only its body shrinks to the aggregation expression. New peers in `models/` carry the type and pure data; new peers in `services/` carry the helpers.

This split is **semantic, not cosmetic**: the new files have distinct responsibilities (types vs catalog vs logic) that already exist as concepts in the architecture. The cycle disappearing is a side effect, not the goal.

The lighter "single sibling types file" approach is rejected as the default because it produces a file whose only purpose is "everything the spokes need" — that is the laundering pattern §4.4 of `architecture-violations` warns against. The audit leaves the choice to the spec, but the recommendation is the full split.

### For Pattern B — move shapes to `models/`

State shapes are models per §4.1 ("They describe: shapes, domain data, value objects, discriminated unions, configuration objects"). Putting `WorkspaceState` in `useCases/workspaceQueries.ts` because that's where the queries live confuses **what the state is** with **how it's read**. The fix is mechanical: cut the `type` declaration and any default-state constant out of the use case, paste it into `models/`, fix two imports.

### For Pattern C — `inject()` not dynamic import

Dynamic imports are not the right tool to break a static graph cycle in this codebase — `inject()` is, because it defers resolution to call-time without changing the import graph at all. The `analysisHandlers` / `autoFixMix` precedent already demonstrates this; the macro chain just needs to adopt the same pattern. After the change, `playback.ts` keeps one-function-per-file (§4.4) and looks like every other inject-wired use case.

### For Pattern D — sibling types file in `presentations/views/Sidebar/`

`SidebarRoute` is a presentation type used by both the parent view and its child tabs. A sibling `SidebarTypes.ts` is the one place where a "types file" is actually the right answer, because the presentation layer does not have a `models/` analogue. Internal organisation under `presentations/views/` is unconstrained.

### For Pattern E — loader registry, control inversion

`hostOperations.loadWAMPlugin` should not know that Faust exists. The `if (pluginId.startsWith('faust.')) { … }` branch is a layering violation that the cycle made visible. Inverting control through a small registry is a small change that fixes both the cycle and the layering: each plugin source registers its own loader at init, and `loadWAMPlugin` becomes format-agnostic.

### For Issue 6 — guardrail

Once cycles are zero, add:

```js
{
    name: 'no-circular',
    severity: 'error',
    comment: 'Prevent circular dependencies. See .agents/audits/circular-dependencies.md for context.',
    from: {},
    to: { circular: true },
}
```

to `.dependency-cruiser.cjs` `forbidden` array. This is a CI-config change and requires explicit approval per CLAUDE.md safety rules.

## Recommendation

Start with **Pattern B** (Issue 2). It is the lowest-risk, smallest-diff change, exercises the audit's diagnostic accuracy on the simplest case, and unblocks confidence for the larger Pattern A work. After Pattern B lands and validates clean, proceed to Pattern A in three sub-steps (one hub at a time, starting with `MidiPatternLibrary` because it has the smallest spoke count). Patterns D, C, E follow in any order. Add the `no-circular` rule last.

A spec is required before implementation begins (per `documentation-gatekeeper`): `.agents/specs/circular-dependency-cleanup.md` should record the implementation choices flagged in **Open questions** (full split vs sibling, `inject()` vs singleton, incremental vs end-of-line guardrail).

Acceptance for the eventual spec:

- `npx madge --circular --extensions ts,tsx src` reports 0
- `pnpm deps:validate` passes
- `pnpm typecheck` passes
- `.dependency-cruiser.cjs` includes a `no-circular` rule

## Resolved

All 5 file-level patterns from this audit cleared in `main` on **2026-04-11**. madge count went from 38 → 1; the remaining cycle is the macro chain, which is mediated by `await import(...)` and is now ignored by the new `no-circular` depcruise rule per the dynamic-import convention. `pnpm typecheck` and `pnpm deps:validate` both pass.

- ~~Issue 1 — Pattern A: hub aggregators conflate model types, services, and value catalogs~~ — resolved on 2026-04-11.
  - `MidiPatternLibrary.ts` → split into `models/MidiPatternTypes.ts` (types + key/scale tables) + `services/scaleTheory.ts` (`getScalePitches`, `snapToScale`, `chordFromDegrees`, `filterTemplates`). Aggregator file shrunk to `PATTERN_TEMPLATES = [...]` plus re-exports.
  - `DeviceParameter.ts` → split into `models/DeviceParameterTypes.ts` (all 6 types). Aggregator file kept its `BUILTIN_PLUGINS`, synth/drum variant builders, and platform helpers — the spec called for a `services/` extraction but those builders are catalog-bound (they read `BUILTIN_INSTRUMENT_DESCRIPTORS`) and would just create a new cycle if extracted. Type-only split is the right shape here. **Deviation from spec — documented.**
  - `CommandRegistry.ts` → split into `models/CommandEntry.ts` (type) + `services/commandSearch.ts` (`fuzzyMatch`, `searchCommands`). Aggregator kept `commandRegistry` and a thin `searchCommands` wrapper bound to the aggregated catalog.

- ~~Issue 2 — Pattern B: state-shape types live inside `useCases/` instead of `models/`~~ — resolved on 2026-04-11.
  - `Arrangement/scratchPadStore.ts` and `useCases/scratchPad/scratchPadCrud.ts` now both import `ScratchPadSection` from the existing `models/ScratchPadSection.ts`.
  - `Collaboration/stores/collaborationStore.ts` and `useCases/collaborationQueries.ts` both import from `models/CollaborationTypes.ts`. The use case re-exports `CollaborationPeer = PeerInfo` to keep the existing public name on `index.ts`.
  - `Command/stores/macroStore.ts` and `useCases/macro/recording.ts` both import `Macro` from `models/Macro.ts`.
  - `Transport/stores/transportStore.ts` now imports `TransportState` and `defaultTransportState` directly from `models/TransportState.ts`. The 3-node cycle through `repositories/transport.ts` is gone as a side effect.
  - `Workspace/stores/workspaceStore.ts` and `useCases/workspaceQueries.ts` both import `WorkspaceState` from `models/WorkspaceState.ts`. The use case re-exports the type so `index.ts` keeps its current source path. The 3-node cycle through `repositories/workspace.ts` is gone.

- ~~Issue 3 — Pattern C: macro handler chain has a static cycle through `getMacroHandlers`~~ — resolved (in spirit) on 2026-04-11. **Deviation from spec — see below.**
  - The spec proposed wrapping `playMacro` in `inject({ executeAppAction })`. **That is the wrong fix.** `inject()` defers *resolution* but the dependency map still has to be a *static import binding* — `import { executeAppAction } from '../executeAppAction'` would re-create the same static cycle. `inject()` does not break static graphs; only dynamic imports do.
  - The actual fix: leave `playback.ts` with its existing `await import('../executeAppAction')` (which is the right pattern for this codebase) and add a `no-circular` rule to `.dependency-cruiser.cjs` that excludes cycles broken by dynamic-import edges (`dependencyTypesNot: ['dynamic-import']`). This matches the precedent in `AudioAnalysis/handlers/analysis/handleAutoFixMix.ts:7` which also uses `await import('#/modules/Command')` for the same shape of cycle.
  - The `analysisHandlers` / `autoFixMix` precedent the audit referenced was misread on first inspection — that handler uses dynamic import, not `inject()`.

- ~~Issue 4 — Pattern D: sibling tab files import the parent view for a type~~ — resolved on 2026-04-11.
  - `SidebarRoute` extracted into `Workspace/presentations/views/Sidebar/SidebarTypes.ts`. `Sidebar.tsx` re-exports it for any external `SidebarRoute` consumers; tab children import from `./SidebarTypes`.

- ~~Issue 5 — Pattern E: WAM host knows about Faust~~ — resolved on 2026-04-11.
  - New `Plugin/services/pluginLoaderRegistry.ts` exposes `registerPluginLoader(idPrefix, loader)` / `findPluginLoader(pluginId)` over a module-private `Map`.
  - `compilerEngine.ts` registers `'faust.'` against its loader at module init (side-effect at end of file). `compilerEngine` is always loaded at app bootstrap because the `Plugin` barrel re-exports its functions and multiple modules consume them, so the registration always fires.
  - `wamPluginHost/hostOperations.ts` no longer imports `compilerEngine` (static or dynamic). `loadWAMPlugin` now consults `findPluginLoader(pluginId)` and falls through to its existing `descriptor.isHighEnd` / passthrough branches.

- ~~Issue 6 — `.dependency-cruiser.cjs` does not enforce `no-circular`~~ — partially resolved on 2026-04-11. **Severity is `warn`, not `error` — see below.**
  - Rule added to `.dependency-cruiser.cjs` `forbidden` array with `dependencyTypesNot: ['dynamic-import']`.
  - Severity is **`warn`**, not the spec's `error`, because enabling it as `error` surfaces **~630 pre-existing barrel-mediated cycles** that pre-date this audit. These are cycles like `bootstrap.ts → Toaster → Arrangement → Transport → AudioEngine → bootstrap.ts` — multi-hop chains routed through `index.ts` barrels. `madge` did not see them because it scopes to file-level imports without resolving cross-module barrel paths.
  - The 38 file-level cycles from this audit are all cleared. The remaining ~630 are an entirely separate cleanup pass that requires re-thinking how barrel imports compose. **Tracked as follow-up below.**

### Verification (2026-04-11)

```
$ npx madge --circular --extensions ts,tsx src
Processed 2552 files (3.7s) (344 warnings)
✖ Found 1 circular dependency!
1) modules/Command/handlers/macro/handlePlayMacro.ts > modules/Command/useCases/macro/playback.ts > modules/Command/useCases/executeAppAction.ts > modules/Command/useCases/getMacroHandlers.ts

$ pnpm deps:validate
x 631 dependency violations (0 errors, 631 warnings). 1856 modules, 5261 dependencies cruised.
exit=0

$ pnpm typecheck
(clean)
```

The single madge cycle is the macro chain, which is mediated by `await import('../executeAppAction')` in `playback.ts:21`. The new `no-circular` depcruise rule excludes it via `dependencyTypesNot: ['dynamic-import']`, matching the codebase convention established by `handleAutoFixMix.ts`.

### Follow-up: ~630 barrel-mediated cycles

A new finding discovered while landing this audit's fixes: enabling `no-circular` in depcruise surfaces ~630 cycles routed through cross-module barrel imports (`#/modules/X` re-exports a use case that depends on a downstream module that ultimately re-imports something from `X`). These were always there; nothing in CI was looking. They are not in scope for this audit but should be tracked separately. The depcruise rule is `warn` until they're addressed; bumping to `error` is the right gating mechanism for the cleanup.

Suggested next session: write a follow-up audit `circular-dependencies-barrels.md` enumerating the cycle clusters by entry point (likely `bootstrap.ts`, individual module barrels under heavy reuse), and decide whether to thin specific `index.ts` exports, push consumers to relative imports inside the same module, or split the heaviest barrel modules.
