# Boundary Enforcement — Laundering Patterns and How We Close Them

A green `pnpm deps:validate` run is **not** proof the architecture is intact. Dependency-cruiser
enforces resolved import **edges**; it does not understand re-export provenance, layering
_direction_, or write-surface breadth, and by default it never sees type-only edges. This doc is the
durable checklist of the ways a real boundary violation can slip past the tooling, and the concrete
mechanism this repo uses to close each one.

This complements the boundary model in
[03-typescript-module.md](./03-typescript-module.md) (§3.3, §4, §6). When you add or change a
boundary rule, check it against every row below.

## The gates

`pnpm deps:validate` (`scripts/check-dependency-boundaries.mjs`) first runs its static source
guards, then seven gates, each with its own exact known-violations baseline (repaired debt cannot stay
silently authorized):

| Gate                    | Source                                 | Sees                                                    |
| ----------------------- | -------------------------------------- | ------------------------------------------------------- |
| main                    | `.dependency-cruiser.cjs`              | value + tagged type-only edges (`tsPreCompilationDeps`) |
| contract re-export reg. | static `export … from` syntax reader   | re-exports of private folders from contract folders     |
| module tiers            | `.dependency-cruiser.module-tiers.cjs` | module-pair edges against tiers; module-level cycles    |
| worker spawns           | static AST reader                      | `new Worker(new URL(…))` and `?worker` targets          |
| reachability            | `.dependency-cruiser.reachability.cjs` | transitive causal edges                                 |
| types                   | `.dependency-cruiser.types.cjs`        | type-only-specific duplicate boundary rules             |
| tests                   | `.dependency-cruiser.tests.cjs`        | test-inclusive barrel boundaries                        |

## Worker spawns

`new Worker(new URL('./x.ts', import.meta.url))` is a URL reference, not an import, so dependency-cruiser
never draws an edge to the worker entry and the `workers-*` isolation rules reach it only by file location.
An entry outside a `workers/` folder would run unconstrained code on another thread with no rule applying.
The **worker spawns** gate closes this: it reads every `new Worker(...)` and `new SharedWorker(...)` and every
import specifier ending in `?worker` or `?sharedworker` in production code under `src/`, resolves the target,
and reports a row unless it lies under `src/modules/<Module>/workers/` or `src/infra/<area>/workers/`. A target
that is not a string literal is a row too, since nothing can check where it points. `?worker&url` is a worklet
processor URL and is governed by `worklets/` instead. A specifier built at run time, such as `import(path)`, is
invisible to any static reader and stays a review matter.

## The six laundering patterns

1. **Type-only imports are invisible.** With `tsPreCompilationDeps` unset, `import type` edges do
   not exist, so a module can import another module's private model/handler _types_ with zero
   value-edge violations.
   → **Closed by** the dedicated **types cruise** (`.dependency-cruiser.types.cjs`,
   `tsPreCompilationDeps: 'specify'`), which re-runs the boundary rules against `type-only` edges as
   `<rule>-type-only`, plus ESLint `sourdaw/no-type-only-private-module-import`. A deep type import
   from `src/app`/`src/routes` trips `external-module-contracts-only-type-only`.

2. **Re-export laundering through a barrel.** A legal contract barrel (or a use-case file) can
   `export { fn } from '../repositories/Y'` and launder a private symbol out through a public
   surface; dep-cruiser cannot read re-export provenance. The edge rules anchored to
   `<contract>/index.ts` see only the barrel's own hop, so a carrier file beside the barrel —
   re-exporting a private symbol and re-exported by the barrel in turn — used to pass clean.
   → **Closed by** `contract-barrel-scope` (a `<contract>/index.ts` may re-export only from its own
   folder), `no-models-repos-transformers-in-index`, `no-usecase-type-exports-on-index` (types
   cruise), ESLint `sourdaw/no-usecase-repository-reexport`, and the **contract-folder re-export
   register** in `scripts/check-dependency-boundaries.mjs`, which reads the `export … from` syntax
   of every file in a contract folder (`useCases|events|stores|presentations/views`, barrel or not)
   and fails `pnpm deps:validate` on any re-export reaching `models/`, `repositories/`, or
   `transformers/` that is not an exact registered baseline row. The register is what makes the
   closure honest: publishing deliberate model vocabulary through a carrier file stays a
   reviewed, individually registered decision, while any unregistered hop fails by name.

3. **Adapter / bridge-file laundering.** A rule anchored only to a vendor package misses callers
   that reach the same capability _through_ a thin in-repo adapter.
   → **Closed by** widening the rule's `to` target to the adapter itself: `desktop-ipc-only-in-repositories`
   (`.dependency-cruiser.shared.cjs`) matches `(/@tauri-apps/ | ^src/utils/desktopBridge.ts$)`, so only
   module-root `repositories/` and the exact bridge adapter may originate IPC; every other caller of
   the bridge is now an error. The `@tauri-apps` half of that pattern outlived the shell it named and
   stays as a reintroduction guard: the dependency is deleted, so any import of it anywhere is an error.

4. **Rules anchored to a retired file layout.** A rule whose `from`/`to` regex points at a file
   shape that no longer exists (e.g. a module-root `index.ts`) silently never matches the real
   barrel.
   → **Closed by** re-anchoring every barrel rule to the live contract-folder form
   `(useCases|events|stores|presentations/views)/index.ts` (`cross-module-index-only`,
   `contract-barrel-scope`, `no-models-repos-transformers-in-index`, …). The retired module-root
   barrel is rejected outright by the architecture checker: a module-root `index.ts` is an error.

5. **`from`-scope exclusions.** A cross-module rule scoped `from: ^src/modules/` never inspects an
   importer that lives _outside_ that prefix (`src/app`, `src/components`, `src/routes`,
   `src/infra`, `src/utils`, `src/helpers`) but still reaches module internals.
   → **Closed by** a dedicated origin rule per non-module root, all carried into the types cruise:
   `external-module-contracts-only` (`^src/(app|components|routes)/`, barrels only) and the
   total-ban `infra-no-module-imports`, `utils-no-module-imports`, `helpers-no-module-imports`.
   `app-to-modules-public-surface-only` covers the live `^src/app/` composition root.

6. **Violation classes with no rule at all.** The contract-barrel rule only checks that the import
   _path_ is a barrel — it says nothing about layering _direction_ or write-surface breadth. A
   `models/` file importing `useCases/`, a repository calling a use case, a `stores/` file that _is_
   a use case, or a cross-module `store.set()` all pass.
   → **Closed by** direction/purity rules (`models-are-pure`, `events-are-pure`,
   `repositories-no-business`, `usecases-only-write-boundary-to-repositories`) and ESLint
   (`sourdaw/no-repository-usecase-import` (error), `sourdaw/no-model-layer-upward-import`,
   `sourdaw/no-foreign-store-write`). A few structural variants (e.g. a `stores/` file that is
   really a use case) remain open decisions in the architecture open-decision docket, not silent
   gaps.

## Rule of thumb

Before trusting a green run, ask of any new boundary: _would a type-only edge evade it? a re-export?
a bridge file? an importer outside `src/modules/`? does it constrain direction, or only the import
path?_ If any answer is "yes/only-path," the rule is value-edge-shaped and needs a types-cruise twin
and/or an ESLint companion.
