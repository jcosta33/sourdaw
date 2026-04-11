# Circular dependency cleanup

## Context

`npx madge --circular --extensions ts,tsx src` reports 38 intra-module circular dependencies clustered into 5 structural patterns. `pnpm deps:validate` is silent on this — `.dependency-cruiser.cjs` has no `no-circular` rule. Cycles cause non-deterministic module-load order (Vite HMR / Vitest hoisting), and the `inject()` resolver throws on runtime cycle traversal, so the existing dynamic-import workarounds in `Command/useCases/macro/playback.ts` and `Plugin/useCases/wamPluginHost/hostOperations.ts` will start surfacing as runtime errors as more code adopts `inject()`.

Audit: `.agents/audits/circular-dependencies.md`.

---

## Goal

Zero circular dependencies under `src/`, with `.dependency-cruiser.cjs` enforcing `no-circular` so the count cannot regress. Each fix is a real responsibility split, not cosmetic re-routing.

---

## User-visible behavior

None. This is a structural cleanup. The user-facing behavior of every affected module is preserved exactly.

---

## Scope

**In scope:**

- All 38 cycles reported by `madge` in 5 patterns (A–E) per the audit.
- Adding a `no-circular` rule to `.dependency-cruiser.cjs` after the count reaches zero.

**Non-goals:**

- Cross-module boundary work (already enforced by existing cruiser rules).
- Reorganising public `index.ts` surfaces (none of the cycles cross `index.ts`).
- Behavior changes, API redesigns, or unrelated refactors discovered along the way.

---

## Requirements

1. **Pattern A — hub split.** `MidiPatternLibrary.ts`, `DeviceParameter.ts`, `CommandRegistry.ts` are each split into a `models/` types-and-data file, a `services/` helpers file, and a shrunken aggregator that contains only the catalog constant. Spokes import the type from the new model file, never from the aggregator.
2. **Pattern B — state shapes in models.** `ScratchPadSection`, `CollaborationState`, `Macro`, `TransportState` (+ `defaultTransportState`), `WorkspaceState` live in `models/`. Stores and use cases both import from `models/`. State-shape types must not be defined in `useCases/`.
3. **Pattern C — macro chain via `inject()`.** `playMacro` in `Command/useCases/macro/playback.ts` uses `inject({ executeAppAction })` to break the static cycle. The `await import('../executeAppAction')` workaround is removed.
4. **Pattern D — Sidebar route type.** `SidebarRoute` lives in a sibling file under `Workspace/presentations/views/Sidebar/`. Both `Sidebar.tsx` and the tab files import it from there.
5. **Pattern E — plugin loader registry.** `wamPluginHost/hostOperations.ts` no longer references Faust by id-prefix. A small intra-`Plugin` loader registry maps id-prefix → loader function. `compilerEngine` registers `'faust.'` against its loader at init.
6. **`no-circular` rule.** `.dependency-cruiser.cjs` has a `no-circular` rule with severity `error` once the count reaches zero. `pnpm deps:validate` returns clean.

---

## Constraints

- Same-module imports use **relative paths**, never `#/modules/<SameModule>` (per `03-typescript-module.md` §3.3 rule 6).
- `index.ts` files are not modified — none of the cycles cross the public surface, and the spec must not regress `index-ts-boundary-audit.md` work.
- No bulk edits. Every file change is an explicit `Edit`/`Write`. No shell loops, no codemods.
- Behavior is preserved. This is a move-and-rename pass, not a rewrite.
- `pnpm deps:validate` must pass at every checkpoint and at the end.
- `pnpm typecheck` must pass at the end.

---

## Design decisions

### Decision: Pattern A — full model + service split, not a single sibling `Types.ts`

**Chosen:** Each hub becomes three files. The aggregator file keeps its current path/name; new peers in `models/` and `services/` carry the type/data and helpers respectively.

**Considered and rejected:**

- **Sibling `Types.ts` next to the hub.** Rejected because the resulting file's only purpose would be "everything the spokes need to break the cycle" — exactly the cosmetic compliance pattern §4.4 of `architecture-violations` warns against. The full split is the only option where the new files have a real, separate responsibility (types vs catalog vs logic) that already exists as a concept in §4.1 / §4.8.
- **Move types into the spoke folder (e.g. `Patterns/Types.ts`).** Rejected because the aggregator and the spokes both need the type, and putting the type "below" the aggregator inverts the natural model layering.

### Decision: Pattern C — `inject({ executeAppAction })`, not dynamic import or file inlining

**Chosen:** `playMacro` is wrapped with `inject({ executeAppAction })`. Resolution-at-call-time defers the dependency without changing the import graph.

**Considered and rejected:**

- **Keep the existing `await import('../executeAppAction')`.** Rejected because the static cycle still exists through `getMacroHandlers`; the dynamic import is on the wrong edge.
- **Inline `playback.ts` into `handlePlayMacro`.** Rejected because it loses one-function-per-file (§4.4) and does not match the documented `analysisHandlers` / `autoFixMix` precedent in `inject-orchestration-opportunities.md` §156–158.

### Decision: Pattern E — module-private singleton registry, not `inject()`

**Chosen:** A `Plugin/services/pluginLoaderRegistry.ts` file containing a singleton `Map<string, LoaderFn>` plus `registerPluginLoader` / `findPluginLoader` functions. `compilerEngine` calls `registerPluginLoader('faust.', …)` at module init. `loadWAMPlugin` calls `findPluginLoader(pluginId)`.

**Considered and rejected:**

- **`inject()` for the registry.** Rejected because `hostOperations` already holds its own `registry` and `instances` maps as module-private singletons (`hostOperations.ts:4–5`); the loader registry matches that precedent. `inject()` would add ceremony without changing the architectural meaning.

### Decision: Add `no-circular` rule at end-of-line, not incrementally

**Chosen:** Add the rule once after Pattern E lands and the count is zero.

**Considered and rejected:**

- **Bump an allowed-count down per pattern.** Rejected because dependency-cruiser does not have an "allowed count" mechanism for cycles; the rule is binary. Incremental enforcement would require disabling the rule per cycle, which is more noise than safety net.

---

## Acceptance criteria

- [ ] `npx madge --circular --extensions ts,tsx src` reports 0 circular dependencies
- [ ] `pnpm deps:validate` passes with zero violations (with the new `no-circular` rule active)
- [ ] `pnpm typecheck` passes
- [ ] `.dependency-cruiser.cjs` contains a `no-circular` rule with severity `error`
- [ ] No `index.ts` file under `src/modules/` was modified
- [ ] Audit `.agents/audits/circular-dependencies.md` updated: every issue marked resolved with the date

---

## Implementation notes

### Order

Per the audit's recommendation:

1. Pattern B (5 cycles, smallest blast radius, warm-up).
2. Pattern A — `MidiPatternLibrary` first (4 spokes, smallest hub), then `DeviceParameter` (15 spokes), then `CommandRegistry` (10 spokes).
3. Pattern D (`SidebarRoute` extract).
4. Pattern C (`inject({ executeAppAction })`).
5. Pattern E (loader registry).
6. Add `no-circular` rule, run `pnpm deps:validate` and `pnpm typecheck`, update audit.

Run `npx madge --circular --extensions ts,tsx src 2>&1 | tail -5` after each pattern as a checkpoint.

### Pattern B — file-by-file moves

For each store/useCase pair:

- Cut the state-shape `type` declaration (and any default-state constant) out of the use-case file.
- Paste it into the corresponding `models/<Name>.ts` file. For `ScratchPadSection`, the file already exists — add the type alongside `createScratchPadSection`.
- Update the store import to point at `models/`.
- Update the use case to import the type from `models/` instead of declaring it.

### Pattern A — file-by-file splits

For each of the three hubs:

1. Create the new `models/<HubName>Types.ts` file with the types and pure data tables.
2. Create the new `services/<hubName><Helpers>.ts` file with the helper functions.
3. Update every spoke's import to point at the new model file.
4. Shrink the original hub file to only the aggregator constant. Keep the file name and path so any in-module callers don't move (and so the shrunken file remains a stable import target for the catalog itself).
5. Run `madge --circular` on just that module's directory to confirm the cycles for that hub are gone.

### Pattern C — `inject()` shape

Match `analysisHandlers` / `autoFixMix` precedent. Roughly:

```ts
export const playMacro = inject({ executeAppAction })(
    ({ executeAppAction }) =>
        async (macroId: string): Promise<void> => {
            // existing body, calling executeAppAction directly
        }
);
```

Drop the `await import('../executeAppAction')`. The static `import` of `executeAppAction` at the top of `playback.ts` is also removed (since `inject()` resolves at call-time).

### Pattern E — registry shape

```ts
// src/modules/Plugin/services/pluginLoaderRegistry.ts
type PluginLoader = (pluginId: string, context: AudioContext, groupId: string) => Promise<AudioNode | null>;
const loaders = new Map<string, PluginLoader>();
export function registerPluginLoader(idPrefix: string, loader: PluginLoader): void { … }
export function findPluginLoader(pluginId: string): PluginLoader | null { … }
```

`hostOperations.loadWAMPlugin` calls `findPluginLoader(pluginId)` instead of branching on `'faust.'`. `compilerEngine` calls `registerPluginLoader('faust.', …)` at module init.

---

## Test plan

This is a structural change with no behavior delta. The test plan is mechanical:

- [ ] `npx madge --circular --extensions ts,tsx src` returns "No circular dependency found!" or equivalent (count 0)
- [ ] `pnpm deps:validate` returns clean with the new `no-circular` rule
- [ ] `pnpm typecheck` returns clean
- [ ] Existing test suites pass (no test changes needed): `pnpm test` for affected modules — Arrangement, Collaboration, Command, Transport, Workspace, AiRuntime, Plugin
- [ ] Manual smoke: open the app, exercise the Sidebar tabs (Pattern D), play a saved macro (Pattern C), load a Faust plugin (Pattern E)

---

## Open questions

None. All three previously-open questions resolved in **Design decisions** above.

---

## Tradeoffs and risks

- **Pattern A creates more files.** Three modules each gain two new files (model + service). The cycle count justifies it; the audit's `## Risks` section documents the `inject()` runtime-failure risk that motivates fixing this proactively.
- **Pattern E loader registry is a new singleton.** The audit acknowledges this matches existing precedent in `hostOperations.ts`. If a future test needs to reset the registry, it can call a `clearPluginLoaders()` helper — add it only when needed.
- **The `no-circular` rule may catch latent cycles** that `madge` did not (different traversal). If `pnpm deps:validate` reports cycles after the rule lands, treat them as Pattern A/B/C/D/E variants and apply the same playbook.
- **In-flight git changes.** `git status` shows many in-progress renames (PascalCase folder rename pass) and new spec files. The cycle-cleanup work must coexist with those changes; do not stage or commit unrelated files.
