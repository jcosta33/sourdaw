# Module boundary strategy — contract-folder barrels

## Scope

How modules expose themselves to each other. Specifically: whether a single root `<module>/index.ts` per module is the right cross-module contract surface, or whether each contract folder (`useCases/`, `stores/`, `events/`, `presentations/views/`) should own its own `index.ts`.

**In scope:**

- The file topology that other modules import from.
- `.dependency-cruiser.cjs` rule changes required for a new topology.
- Updates to `docs/architecture/03-typescript-module.md` and `.agents/skills/architecture-violations/SKILL.md` that follow from a new topology.
- Migration strategy, module-by-module.
- Acceptance criteria for declaring a module "migrated."

**Out of scope:**

- The ownership / misplaced-state issues tracked in `circular-dependencies-barrels.md` (Issues 1–3). Those are separate work and are not solved by this change alone — this change reduces cycle *blast radius*, not cycle *count*. The two audits are complementary.
- The file-level cycles already cleared in `circular-dependencies.md`.
- The macro-chain dynamic-import cycle (structurally fine; depcruise already excludes it).
- The user's in-progress PascalCase rename of `AiRuntime/models/{tools,presetActions}/`, `Command/models/commands/`, etc. That's orthogonal and is causing the current typecheck noise; this audit does not depend on it being resolved.

## Goal

Each module exposes four independently-importable contract surfaces instead of one aggregated surface. Cross-module imports target a specific contract:

```ts
import { trackStore } from '#/modules/Arrangement/stores';
import { addTrack } from '#/modules/Arrangement/useCases';
import type { TrackAddedEvent } from '#/modules/Arrangement/events';
import { ArrangementView } from '#/modules/Arrangement/presentations/views';
```

No module-root `index.ts`. No aggregated barrel. The `cross-module-index-only` depcruise rule is redefined to accept any of the four contract-folder `index.ts` files as a valid target, and nothing else.

When this is done:

- `madge --circular` and `depcruise`'s `no-circular` rule report a sharp drop in cycle count.
- `pnpm deps:validate` can flip `no-circular` from `warn` → `error` without blocking CI.
- The `{ lazy: true }` getter workaround in `Transport/useCases/{ensureTrackStrips, startPlayback, toggleRecording}.ts` becomes unnecessary (follow-up; tracked in `circular-dependencies-barrels.md` Issue 4).
- New TDZ landmines from barrel cycles become structurally impossible for consumers that only need a narrow contract.

## Relevant code paths

- `.dependency-cruiser.cjs:54–140` — `no-circular`, `cross-module-index-only`, `module-index-contract-only`, `no-self-barrel-import`, `no-usecase-type-exports-on-index`, `no-models-repos-transformers-in-index`. All will need edits.
- `docs/architecture/03-typescript-module.md §3.1–§3.3` — the section that defines the current "root index.ts as sole public surface" rule.
- `.agents/skills/architecture-violations/SKILL.md §5` — "Module Boundary: `index.ts`" section, which encodes the current rule and forbidden patterns.
- `.agents/audits/circular-dependencies-barrels.md` — this audit's direct predecessor. It documents the cycle count (1014 unique), the bidirectional pair problems, and identifies barrel topology as the amplifier.
- `src/modules/*/index.ts` — every module's current root barrel. All will need to be deleted (or emptied) and replaced with contract-folder barrels.
- `src/infra/di/inject.ts` — the `inject()` helper. No code change here, but the rationale for this migration hinges on its interaction with barrel cycles. Unchanged after migration; the `{ lazy: true }` getter option is retired once the underlying cycles are gone.

## Current behavior

Each module has one root `index.ts`. Cross-module imports target that one file:

```ts
import { addTrack, trackStore, ArrangementView } from '#/modules/Arrangement';
```

The `cross-module-index-only` depcruise rule enforces this.

Each root barrel re-exports from four contract folders (`useCases/`, `stores/`, `events/`, `presentations/views/`) per `03-typescript-module.md §3.1`. Everything else — `models/`, `repositories/`, `services/`, `transformers/`, `handlers/`, `validators/`, `presentations/{hooks,components,context,stores,renderers}/`, `engine/`, `runtime/`, `worklets/`, `errors/` — is private and not importable cross-module.

**Scale of the problem this creates:**

- `src/modules/Arrangement/index.ts` has ~200 re-exports.
- Importing one symbol from Arrangement evaluates the entire root barrel, which evaluates every re-exported file and its transitive dependencies.
- The `circular-dependencies-barrels.md` audit measured **1014 unique cycles** under the current topology, with Arrangement participating in 1042 cycle hits.
- Three runtime TDZ crashes surfaced during the file-level cycle cleanup; each crashed at an `inject({ dep })` deps object literal evaluating at module top-level with `dep` in TDZ from a mid-evaluation source module.
- Three `{ lazy: true }` getter workaround sites exist today (`Transport/useCases/ensureTrackStrips.ts`, `startPlayback.ts`, `toggleRecording.ts`). They patch the symptom, not the cause.

**Why the root barrel amplifies cycles:**

`export { foo } from './bar'` is not lazy. When any consumer imports anything from the barrel, JavaScript fully evaluates every re-export statement in order. For a module with 200 re-exports, the blast radius of a single import is the transitive closure of all 200 files. Any back-edge anywhere in that closure closes a cycle.

A consumer that only needs one store evaluates the entire use-case graph, the entire view graph, and every transitive dep of every one of those. The consumer paid zero of the "benefit" (the narrow one-symbol import) and all of the "cost" (the full transitive evaluation).

## Findings

1. **The barrel pattern is not incidentally broken — it is structurally broken in this codebase.** The cycle count, the TDZ crashes, and the `{ lazy: true }` workaround are not results of lack of discipline. They are the inevitable consequence of ES module eager re-export semantics combined with `inject()` evaluating deps object literals at module top-level, combined with large aggregated barrels. No amount of curation would fix this while the topology stays the same — a 100-export barrel has the same blast-radius problem as a 200-export barrel, just smaller.

2. **The four contract folders already exist as a defined architectural concept.** `03-typescript-module.md §3.1` lists `useCases/`, `events/`, `stores/`, and `presentations/views/` as the only four folders the root barrel may re-export from. The architecture already treats these four as distinct "contracts." The current topology aggregates them into one file; the proposed topology exposes each as its own addressable barrel. The underlying contract concept is unchanged.

3. **Stores are a leaf layer.** They do not import from `useCases/`, `handlers/`, `presentations/`, or `services/`. After Pattern B fixes in the prior cycle audit, they don't even import their own module's use cases. A `stores/index.ts` barrel has a tiny transitive closure — just the stores themselves plus `createStore` and storage adapters. **Cross-module imports of a store will have near-zero cycle risk** under the new topology.

4. **Use cases have a wider graph but exclude presentations.** A `useCases/index.ts` barrel pulls in use cases plus their transitive deps (repositories, services, validators, models, other stores). It does NOT pull in views, components, or hooks. The current crashes that routed through `Command/presentations/views/CommandPalette.tsx` would be structurally impossible for any consumer that imports only from `Command/useCases` — that file simply isn't in the graph.

5. **Presentations views are the heaviest and least-needed cross-module.** Of the four contract surfaces, views have the largest transitive closure (they drag in every store and use case they read and every other view they compose). Exposing views as their own barrel means consumers that *don't* need views (most of them) never pay that cost.

6. **Events are trivially small.** An `events/index.ts` barrel re-exports typed event payloads. Events are plain types or simple object literals. Near-zero graph cost.

7. **The "discoverability" argument for a single barrel is weak.** The claim that "one `index.ts` per module lets the author curate the public contract" assumed the author would curate. In practice, `Arrangement/index.ts` has accumulated 200+ exports without review because adding one more was always cheaper than saying no. Four smaller barrels are genuinely curate-able because each has a clearer scope: `stores/index.ts` can only contain store instances.

8. **The migration is mechanical and incremental.** Each module is independent. Start with Arrangement, move to the next. Each migration is ~5 edits to the module itself plus ~N edits to consumers (N = number of files importing from `#/modules/<Module>`). `pnpm typecheck` and `pnpm deps:validate` are the after-each-module checkpoint. No module needs to be fully-migrated-and-perfect before the next one starts; the cross-module-index-only rule can tolerate both old and new forms during migration via a transitional regex.

9. **This does not replace the ownership fixes in `circular-dependencies-barrels.md`.** Those fixes (move misplaced state, push composition logic up) are still required. Contract-folder barrels reduce cycle *exposure* per import, but a use-case-to-use-case back-edge between two modules still forms a cycle even with small barrels. The two audits are additive: this one changes topology; that one corrects ownership.

## Priorities

1. **Update `.dependency-cruiser.cjs`** to accept contract-folder barrels as cross-module import targets. Transitional: accept both forms during migration.
2. **Update `docs/architecture/03-typescript-module.md §3.1–§3.3`** to document the new topology. Deprecate the old "root `index.ts` only" rule.
3. **Update `.agents/skills/architecture-violations/SKILL.md §5`** to match the new rule. This is the file consumers of the skill will read when deciding how to expose symbols.
4. **Migrate Arrangement** (highest cycle count — per the barrels audit, 1042 hits). This is the proof-of-pattern pass and the single biggest cycle-count win.
5. **Migrate the next tier: AudioEngine, Transport, Command** (the other three high-hit hubs). Same mechanical process.
6. **Migrate remaining modules** in descending cycle-count order: Automation, Levain, Plugin, Workspace, MIDI, Project, AiGeneration, AiRuntime, AudioAnalysis, Fermenter, CrdtDocument, Collaboration, Routing, Proof, Synth, Toaster, Yeast, Bacteria, Gluten, Grinder, Scoring.
7. **Delete the root `index.ts` on each module** as part of its migration. No aggregation shim; the point is to cut blast radius.
8. **After all modules are migrated**, flip `no-circular` from `warn` → `error` in depcruise.
9. **Retire the `{ lazy: true }` getter workaround sites** per `circular-dependencies-barrels.md` Issue 4. With no underlying cycles, the getters aren't needed.

## Open issues

### Issue 1 — Depcruise rules need updating to accept contract-folder barrels

**Problem.** The current `cross-module-index-only` rule requires all cross-module imports to target `<module>/index.ts`. After migration, that file won't exist. The rule must accept the four contract-folder barrels instead.

**Representative file.** `.dependency-cruiser.cjs:54–96`

**Needed.**

- `cross-module-index-only` — change the allowed target regex from `^src/modules/(?:Common/|Supporting/)?[^/]+/index(?:\\.ts)?$` to `^src/modules/(?:Common/|Supporting/)?[^/]+/(useCases|events|stores|presentations/views)/index(?:\\.ts)?$`. During migration, allow BOTH forms (add the old form as an alternative in the regex) so partially-migrated consumers don't block CI.
- `module-index-contract-only` — currently says "root `index.ts` may only re-export from the four folders." Becomes: "`<contract-folder>/index.ts` may only re-export from files within its own folder." Each contract-folder barrel has a narrower, self-contained scope.
- `no-models-repos-transformers-in-index` — becomes automatic. The forbidden folders (`models/`, `repositories/`, `transformers/`) simply don't have barrels. Rule can be deleted or simplified to forbid any `index.ts` file inside those folders.
- `no-self-barrel-import` — extends naturally: files inside `Arrangement/` must not import from `#/modules/Arrangement/<any contract>`. They use relative paths within the module. This is a regex extension, not a rule rewrite.
- `no-usecase-type-exports-on-index` — still relevant; applies to the new `useCases/index.ts` barrel. Only functions/constants may cross, not types. Rule regex just needs to target the new path.

### Issue 2 — Architecture doc needs updating

**Problem.** `docs/architecture/03-typescript-module.md §3.1–§3.3` is the authoritative source for module boundary rules. It explicitly says `index.ts` is "the sole cross-module import target" and lists rules that assume a single root barrel. After migration, those rules are wrong and will confuse anyone reading the doc.

**Representative file.** `docs/architecture/03-typescript-module.md:106–220`

**Needed.** Rewrite §3.1–§3.3 to document the contract-folder barrel topology. Key changes:

- §3.1 "Public contract surface" — list the four contract folders as directly importable, each via its own `index.ts`. Remove the single-root-barrel framing.
- §3.3 "`index.ts` — the module boundary" — rewrite as "Module boundaries — contract-folder barrels." Rules become:
  1. Cross-module imports must target `<module>/<contract-folder>/index.ts`. One of: `useCases/index.ts`, `events/index.ts`, `stores/index.ts`, `presentations/views/index.ts`.
  2. Each `<contract-folder>/index.ts` may only re-export from files within its own folder.
  3. No module-root `index.ts`. The root `index.ts` pattern is deprecated and must not be reintroduced.
  4. Same module — never import from `#/modules/SameModule/<contract>`. Use relative paths.
  5. Curate each contract-folder barrel for cross-module need only.
  6. No use-case types on `useCases/index.ts` (unchanged from current rule 5).
- Historical note: add a dated entry marking the change, so readers understand why the rule is different from what they might have seen before.

### Issue 3 — `architecture-violations` skill needs updating

**Problem.** `.agents/skills/architecture-violations/SKILL.md §5` ("Module Boundary: `index.ts`") encodes the current rule as a semantic-compliance requirement. Agents loading this skill will apply the old rule and reject correct code during the migration.

**Representative file.** `.agents/skills/architecture-violations/SKILL.md:182–247`

**Needed.** Rewrite §5 to match the new topology. The forbidden patterns in §2 do NOT need changes — the list of "fake compliance" patterns still applies; the specific rule about barrels just needs to shift from "one root `index.ts`" to "four contract-folder `index.ts` files, no root." Include a transitional note during migration: skills should accept both forms until the migration is complete.

### Issue 4 — Migration sequencing and incrementality

**Problem.** The migration touches every module in the codebase plus every file that imports cross-module (many hundreds of files, per the barrels audit's 440-imports count for just the use-case/handler/store/repository layers). A "big bang" migration would be impossible to review. A poorly-sequenced migration could break CI for days.

**Needed.** An explicit sequencing plan with per-module acceptance criteria. Each module migration is one unit of work:

1. **Create the contract-folder `index.ts` files.** Copy the relevant re-exports from the current root `index.ts` into the appropriate contract folder barrel. Leave the root `index.ts` untouched for now.
2. **Run `pnpm typecheck` and `pnpm deps:validate`.** Confirm green (or at least no regressions from the module's starting state).
3. **Migrate consumers.** For each file that imports from `#/modules/<Module>`, update the import path to the correct contract folder. One file per `Edit` call (per CLAUDE.md's no-automated-bulk-edits rule). Run typecheck after every ~5–10 consumers.
4. **Delete the root `index.ts`.** Only once every consumer has migrated. `grep -r "from '#/modules/<Module>'" src/` must return zero results.
5. **Re-run full validation.** `pnpm typecheck`, `pnpm deps:validate`, `madge --circular`. Cycle count should drop visibly. Commit the module as one unit.

The depcruise rule change in Issue 1 must land BEFORE any module migration and must accept BOTH forms until the last module is done. Otherwise, any partially-migrated state fails validation.

### Issue 5 — Types and the `events/` contract

**Problem.** The architecture doc treats `events/` as the canonical cross-module named-type surface. Currently, types flow through `index.ts` re-exports. Under the new topology, types need to flow through `events/index.ts` explicitly. This is straightforward but needs to be called out so the migration doesn't accidentally lose type contracts.

**Needed.** As part of each module migration, ensure `events/index.ts` re-exports all event payload types that were previously cross-module-visible through the root barrel. Store value types may go through `stores/index.ts`. Use-case input/output types stay intra-module (unchanged from current rule 5).

### Issue 6 — `events/` folders that don't exist yet

**Problem.** Not every module has an `events/` folder today. Some modules currently emit events from use cases or stores directly without a dedicated `events/` folder. Under the new topology, those modules either need to create an `events/` folder (with just an `index.ts`) or skip the events barrel entirely.

**Needed.** Audit each module for presence of `events/`. For modules without one: if they emit events, create a minimal `events/index.ts` re-exporting the type-only payloads. If they don't emit events, no action — a module with no events simply has no `events/index.ts` and nothing imports it.

### Issue 7 — `presentations/views/` vs module root views

**Problem.** Some modules have views at `presentations/views/<ViewName>.tsx` (matches the architectural convention). Others may have views at non-standard paths. Under the new topology, any view intended for cross-module consumption must live at `presentations/views/` and be re-exported from `presentations/views/index.ts`.

**Needed.** Audit each module for cross-module-consumed views. Any view currently re-exported from the root `index.ts` must exist at `presentations/views/<ViewName>.tsx` and be re-exported from `presentations/views/index.ts` during the migration. If a view lives elsewhere (e.g. directly in `presentations/<Name>.tsx`), it's a sign of a pre-existing architectural inconsistency — fix it as part of the migration (move the file) or note it as a follow-up.

### Issue 8 — Contract-folder barrel files vs handlers / repos / services / models

**Problem.** The current architecture forbids cross-module imports into `handlers/`, `repositories/`, `services/`, `validators/`, `transformers/`, `models/`, `engine/`, `runtime/`, `worklets/`, `errors/`. Under the new topology, these folders simply don't have `index.ts` files and therefore can't be imported cross-module. This works but must be spelled out.

**Needed.** Depcruise rule update (`no-models-repos-transformers-in-index` becomes "no `index.ts` in non-contract folders under `src/modules/`"). Document it in the architecture doc. No runtime behavior change.

## Open questions

1. **Transitional coexistence: how long?** The depcruise rule will accept both forms (root `index.ts` AND contract-folder barrels) during migration. Should there be a hard deadline, or just "whenever the last module is done"? Recommendation: no deadline, but add a `warn` rule against new imports from any root `#/modules/<Module>` path as soon as the first module is migrated, so the old form is visibly discouraged.

2. **Should `index.ts` be forbidden at the module root or just empty?** Two options: (a) delete the file entirely; (b) leave it as an empty file or with a comment `// intentionally empty — see <contract-folder>/index.ts` so a grep for `index.ts` doesn't look broken. Recommendation: delete entirely, for unambiguous removal.

3. **Naming: `index.ts` vs something more descriptive?** The file at `Arrangement/useCases/index.ts` is reached as `#/modules/Arrangement/useCases`. An alternative would be `Arrangement/useCases/contract.ts` reached as `#/modules/Arrangement/useCases/contract`. The former is more idiomatic (TypeScript path resolution uses `index.ts` by default); the latter is more explicit. Recommendation: stick with `index.ts` for idiomaticness, and rely on the depcruise rule for enforcement.

4. **Do we flip `no-circular` to `error` mid-migration or at the end?** Recommendation: at the end. During migration, cycle counts will move around unpredictably as the graph changes. Final flip is one commit after the last module is done.

5. **Arrangement first, or pilot with a smaller module first?** Recommendation: Arrangement first. It's the highest-leverage target (1042 cycle hits), and the migration pattern is mechanical enough that a smaller pilot wouldn't teach us much we don't already know. If Arrangement's migration exposes unexpected complexity, pause and re-plan before the next module.

## Risks

- **Migration touches hundreds of files.** The `circular-dependencies-barrels.md` audit counted 440 cross-module barrel imports from just use-case / handler / store / repository folders. Presentations and tests add more. Per CLAUDE.md, every edit must be individual (no shell loops). The per-file edit cost is real and needs to be budgeted.
- **Partial-migration CI regressions.** If the depcruise rule isn't updated first, or isn't tolerant of both forms, the first consumer migration will break validation. The rule update is a strict prerequisite and must land in its own commit before any consumer changes.
- **Test mocks and `vi.mock(...)` calls use module paths too.** Tests with `vi.mock('#/modules/Arrangement', …)` will break — the mock path needs to match exactly what the code imports. The migration must update tests in lockstep with production code. Some tests already break on current master (per the recent session's investigation); those will need to be fixed separately.
- **The user has an in-progress PascalCase rename pass** (lowercase → TitleCase for `AiRuntime/models/{tools,presetActions}/`, `Command/models/commands/`, and a handful of descriptor directories). The git index currently has BOTH casings tracked for some files, and macOS APFS case-insensitive filesystem obscures which is "real." This migration does not interact with that rename directly, but a migration pass through Arrangement will edit files that may themselves be mid-rename. Running `pnpm typecheck` during the migration will surface the pre-existing 49 case-mismatch errors from that rename. **Those errors are not this migration's fault** and should be resolved by the user completing the rename as a separate task.
- **`03-typescript-module.md` is a large doc with many cross-references.** Updates must be thorough enough that skimming readers don't mix the old and new rules. The `architecture-violations` skill must be updated in the same session as the doc, and any audits that link to the old wording should get a footnote.
- **`{ lazy: true }` getter wrappers must NOT be used during the migration.** If a TDZ crash surfaces during consumer migration, the correct response is to fix the underlying cycle (per ownership rules), not patch it with a getter. The existing three workaround sites in Transport should be removed once their underlying cycles are gone, not copied.
- **Migration order matters for cycle-count reduction, but not for correctness.** Any module can be migrated independently. If Arrangement's migration turns out harder than expected, switching to a smaller pilot module first is OK and does not invalidate work done on Arrangement.

## Suggested approaches

### Approach A — "Rule first, transitional mode, per-module migration"

This is the canonical path. Four phases:

**Phase 0 — Preparation (single commit).**

- Update `.dependency-cruiser.cjs` to accept both forms: the current root `<module>/index.ts` AND the new `<module>/<contract>/index.ts`. The transitional regex is:
  ```
  ^src/modules/(?:Common/|Supporting/)?[^/]+/(index|(useCases|events|stores|presentations/views)/index)\.ts$
  ```
- Update `03-typescript-module.md` with the new rules AND a prominent "Migration in progress (YYYY-MM-DD)" banner explaining that both forms are currently valid and the old form is being phased out.
- Update `architecture-violations` SKILL.md §5 similarly.
- Write a spec (`.agents/specs/contract-folder-barrels.md`) with:
  - The final target state
  - Per-module acceptance criteria
  - The post-migration depcruise regex (old form forbidden)
  - The post-migration doc text (old form not mentioned)

**Phase 1 — Pilot: Arrangement.**

Per-module procedure:

1. Create `Arrangement/useCases/index.ts` with the relevant re-exports copied from the root `Arrangement/index.ts`. Similarly for `stores/`, `events/`, `presentations/views/`. Run `pnpm typecheck`.
2. Do a full-repo grep for `from '#/modules/Arrangement'`. List every match. Categorize each by which contract folder it should target (store? use case? event type? view?).
3. For each consumer file, update the import path. One file per `Edit`. Run `pnpm typecheck` after every 5–10 edits.
4. Run `madge --circular`. Verify cycle count drops.
5. Once zero consumers import from `#/modules/Arrangement` (the root), delete the root `Arrangement/index.ts`. Re-run `pnpm typecheck` and `pnpm deps:validate`. Commit.

**Phase 2 — Tier 1: AudioEngine, Transport, Command.**

Repeat the per-module procedure for each. These are the next-highest cycle-count modules. Each is independent; they can be done sequentially or by different sessions.

**Phase 3 — Tier 2: everything else.**

Remaining modules in any order. Each migration is a small, independent commit.

**Phase 4 — Cleanup.**

- Update `.dependency-cruiser.cjs` to forbid the old form. The transitional regex becomes the post-migration regex from the spec.
- Flip `no-circular` from `warn` to `error`. Verify CI stays green.
- Retire `{ lazy: true }` getter wrappers in Transport (per `circular-dependencies-barrels.md` Issue 4). Each site becomes a normal `inject({ … })` call. This only works if the underlying cycle for that site is gone; if not, the site gets a specific follow-up issue.
- Remove the "Migration in progress" banner from `03-typescript-module.md`.

### Approach B — "Module-by-module with no transitional mode"

Alternative: update the depcruise rule once to require the new form, then migrate every module in one session. Higher risk (breaks CI until all modules are done), but avoids the transitional coexistence complexity. Not recommended because the migration is too large for a single session and partial failures would leave the repo in an unmaintainable state.

### Approach C — "Hybrid: delete root index.ts but keep one aggregate file"

Alternative: delete `<module>/index.ts` and replace it with a single `<module>/contract.ts` that re-exports from the four contract-folder barrels. Consumers do `import { ... } from '#/modules/Arrangement/contract'`.

This is worse than Approach A because the aggregate file reintroduces the blast-radius problem — `import { oneThing } from '#/modules/Arrangement/contract'` evaluates all four sub-barrels. Not recommended. Listed here only to explicitly reject it.

## Recommendation

**Approach A, starting with Arrangement.**

Write the spec (`.agents/specs/contract-folder-barrels.md`) before any code changes. The spec resolves the Open Questions with concrete decisions (deleted vs empty root `index.ts`, transitional duration, etc.) and defines per-module acceptance criteria mechanically.

Phase 0 (rule and doc updates) is one commit. Each per-module migration (Phases 1–3) is one commit per module, with `pnpm typecheck`, `pnpm deps:validate`, and `madge --circular` validated at the end of each. Phase 4 (cleanup) is the final commit that flips the rule, retires the getter workarounds, and declares the migration complete.

The migration does not require completing the in-progress PascalCase rename pass first. The case-mismatch errors from that rename are orthogonal — they existed before this migration and will exist after, until the user cleans them up separately.

**Do not start any code changes until the spec is written and approved.**

## Resolved

### Phase 0 — Infrastructure (2026-04-10)

- Wrote `.agents/specs/contract-folder-barrels.md` with concrete decisions.
- Updated `.dependency-cruiser.cjs`:
  - Header comment rewritten to describe contract-folder barrel model.
  - `cross-module-index-only` — transitional regex accepts both old root-barrel and new contract-folder forms.
  - `module-index-contract-only` — retained for legacy root barrels, plus new `contract-barrel-scope` rule enforcing each barrel's self-contained scope.
  - `no-self-barrel-import` — extended to cover contract-folder barrels.
  - `no-usecase-type-exports-on-index` — extended to cover contract-folder barrels.
  - `application-to-modules-public-surface-only` — updated to accept contract-folder barrels.
- Rewrote `docs/architecture/03-typescript-module.md` §3.1–§3.3 as hardline contract-folder barrel rules (no root barrel).
- Updated `.agents/skills/architecture-violations/SKILL.md` §5 to match new topology.

### Phase 1 — Arrangement migration (2026-04-10)

Created:
- `src/modules/Arrangement/useCases/index.ts`
- `src/modules/Arrangement/stores/index.ts`
- `src/modules/Arrangement/events/index.ts`
- `src/modules/Arrangement/presentations/views/index.ts`

Migrated all 177 cross-module consumers of `#/modules/Arrangement` to the appropriate contract-folder barrel. Deleted `src/modules/Arrangement/index.ts`.

**Verification:**
- `pnpm typecheck`: 0 errors
- `pnpm deps:validate`: 0 errors, 587 warnings (down from 629 — 42 fewer cycle warnings)
- `npx madge --circular --extensions ts,tsx src/modules/`: 1 cycle (intentional macro-chain dynamic-import, structurally fine)
