---
type: adr
id: 0058
title: App actions live with their owning modules over a domain-free registry
status: accepted
date: 2026-11-14
owner: The Sourdaw team
sources:
    - src/utils/handlerContract.ts
    - src/app/getProductionCommandHandlerMaps.ts
    - .dependency-cruiser.module-tiers.cjs
    - .dependency-cruiser.cjs
    - scripts/generateVersionedCommandArgumentSchemas.mjs
---

# 0058 - App actions live with their owning modules over a domain-free registry

## Context

One file, `src/utils/handlerContract.ts`, holds the whole `AppAction` discriminated union, the
snapshot payload types its variants reference, and the generic handler contract (`ActionHandler`,
`HandlerDescribeResult`, `HandlerValidationContext`, `ExecuteOptions` and the other `Handler*`
types). `src/utils/createHandler.ts` builds handlers against it.

Measured on 2026-11-14 at `origin/main` 0869e4ea1f:

- The file is 3,865 lines.
- The union has 382 variants.
- About 120 snapshot payload types live beside it.
- About 745 files import it.

`src/utils` is declared cross-cutting and module-agnostic (`utils-no-module-imports`), yet it holds
the central domain contract. Every module's actions, and every other module's view of them, sit in
one file that no module owns.

The same file also invites a second defect. About 31 production files re-derive per-action behaviour
by comparing `action.type` against other modules' action literals, ending in a default branch. An
action added later falls into that default and is silently mis-handled. Examples are
`AiRuntime/transformers/llmActionBridge.ts`, `Command/useCases/macro/playback.ts` and
`Project/useCases/doesProductionBriefAllowActionBatch.ts`. The compiler cannot say which enumerations
a new action must join.

## Decision

1. **The domain-free contract stays in `src/utils/handlerContract.ts`.** That file keeps only the
   generic handler contract (`ActionHandler`, the `Handler*` types, `ExecuteOptions`), and holds the
   empty action registry. `createHandler` stays in `src/utils/createHandler.ts`. Reason: these types
   name no module's language. Every layer may import utils, pure layers included, while the pure
   layers (`models/`, `services/`, `transformers/`, `validators/`) and `repositories/` may not
   import any module's `events/` folder, their own module's included (`models-are-pure`,
   `services-must-stay-pure`, `transformers-must-stay-pure`, `validators-must-stay-pure`,
   `repositories-no-business`). Production files in those layers import `AppAction` today, so a
   contract in `events/` would break them. Handler maps stay registered in `src/app/bootstrap.ts`
   through `getProductionCommandHandlerMaps`, and every mutation still goes through
   `executeAppAction`.

2. **Composed union.** `src/utils/handlerContract.ts` declares `export interface AppActionRegistry {}`,
   with `AppAction = AppActionRegistry[keyof AppActionRegistry]` and
   `AppActionType = AppAction['type']`. Each owning module declares its variants in its own
   `events/` folder, in files named `<area>AppActions.ts`, each within the 600-line ceiling. Each
   such file exports its sub-union and adds exactly one registry key with
   `declare module '#/utils/handlerContract' { interface AppActionRegistry { ... } }`. Reason: utils
   imports nothing, and each module already depends on utils, so composing the union adds no module
   edge and no cycle. Declaration merging works only on interfaces, so a type alias cannot replace
   them. `.oxlintrc.json` sets `typescript/consistent-type-definitions` to `["error", "type"]` and
   `typescript/no-empty-object-type` to error. The empty `export interface AppActionRegistry {}`
   trips both rules, and it carries a line-scoped disable for each. Every owner's
   `interface AppActionRegistry { ... }` augmentation trips `consistent-type-definitions`, and it
   carries a line-scoped disable for that rule. Each directive has the declaration-merging reason
   beside it. The directive form is the one `src/app/router.ts` already uses above its augmenting
   interface: `// eslint-disable-next-line @typescript-eslint/consistent-type-definitions`, with
   `@typescript-eslint/no-empty-object-type` for the empty registry. oxlint honours both
   `eslint-disable` and `oxlint-disable` comments. typescript-eslint documents a disable as the way
   to keep a merge target. This amends the line in `docs/07-conventions.md` that forbids disabled
   lint rules: a declaration-merging target may carry that line-scoped disable and nothing broader.
   Interface augmentation is the TypeScript mechanism for an open, compiler-checked registry. It was verified with both the tsc 7 command line that typechecks the
   repository and the pinned typescript 6 compiler (6.0.3) whose API the schema generator uses,
   together with a transitional key declared in the same interface. `events/` is the cross-module
   type surface for action variants, as it is for event payloads, because §3.3 of
   `docs/architecture/03-typescript-module.md` names `events/index.ts` the canonical cross-module
   named-type surface. A variant union or an events-defined snapshot type is re-exported through
   `events/index.ts` only when another module consumes it by name, like any event payload.
   `AppAction` is composed through the registry augmentation, not through the barrels. The
   augmentation file needs no barrel entry to join the union, because every program's include
   reaches it (decision 8). Model-defined snapshots are not re-exported
   (`no-models-repos-transformers-in-index`).

3. **Ownership oracle.** An action belongs to the module whose `get<Module>Handlers` map registers
   its handler. That set is the one `getProductionCommandHandlerMaps` returns.

4. **Payload and snapshot types.** A snapshot type is defined by the module that owns its concept,
   in that module's `events/` file when no layer that may not import `events/` needs it by name.
   Decision 1 names those layers: `models/`, `services/`, `transformers/`, `validators/` and
   `repositories/`. When any of them needs it, it is defined in the owner's `models/`, and the
   `events/` file references it. Other modules never import a snapshot by
   a deep path. A consumer in a pure layer, and any consumer of a model-defined snapshot, derives the
   type from its action, for example `Extract<AppAction, { type: 'restoreTrack' }>['payload']['track']`.
   `AppAction` is the argument type of `executeAppAction`, the callable contract every module
   dispatches through, so this is the callable-contract derivation root `AGENTS.md` allows. The route
   is limited to types reachable from `AppAction`. The exception is a
   type referenced by an action of a lower-tier module, or of a module the tier manifest would put in
   an unaccepted cycle. Then it lives in the lowest-tier referencing module, as that module's own
   structural snapshot. No placement may add an upward edge or a cycle outside `allowedCycles` in
   `.dependency-cruiser.module-tiers.cjs`. If a type cannot be placed under this rule, the slice
   stops, and this ADR is amended in its own pull request before the slice continues.

5. **`src/utils` holds no domain types.** After the last slice, `handlerContract.ts` holds only the
   domain-free contract and the empty registry, whose declaration carries the line-scoped disables
   from decision 2. The domain types it holds today move to their owners:
   every variant, every snapshot, and `TrackKind`, `AutomationMode` and `AutomationRecordingPolicy`.
   A utility whose only purpose is a moved domain type follows decision 4's placement for that type,
   including the lowest-tier rule and the stop clause. An example is the tempo audio-source
   promotion helpers (`tempoAudioSourcePromotion.ts`, `isTempoAudioSourcePromotion.ts` and
   `tempoAudioSourceCoverage.ts`), which Arrangement, Transport and the kernel module Command all
   import. The slice that moves a utility rewrites its importers. This ADR names no destination.

6. **Shape preservation.** No action, payload or snapshot changes shape during the moves. Undo
   inverses, `describe()` projections and persisted history therefore stay valid. The command
   argument schema generator emits a canonical order, so moving a variant between files leaves the
   generated `src/modules/Command/useCases/versionedCommandArgumentKeys.ts` unchanged except for its
   import line. Any other diff in that file during a move slice means a shape changed, and it blocks
   the slice. The release inventory records only `tracked-set:<label>` entries, so an edit to a tracked file
   moves nothing there. `scripts/checkReleaseInventory.ts` has a tracked set,
   `grand-boule-project-state`, that pins `src/utils/handlerContract.ts` and
   `src/modules/Command/useCases/versionedCommandArgumentKeys.ts` as whole files, to pin the
   GrandBoule device-state action shape. A slice that moves a pinned variant to a new file
   repoints the set's pathspecs and updates the independent path list in
   `scripts/__tests__/checkReleaseInventory.spec.ts`, which asserts that list equals the files
   the pathspecs resolve to. The agent evidence manifest does not move.

7. **Per-action behaviour is one exhaustive lookup per concern.** Code that derives a property of
   each action by enumerating action types with a default branch is a lookup table. Examples are a
   label, affected ids, a policy, a guard, a replay rule, or membership in a set. Such a table
   becomes one record keyed by every `AppActionType`. Use a mapped type, so each entry receives its
   narrowed action and an action without an entry fails to compile. The record lives in the module
   that owns the concern, Command included for kernel concerns.
    - When an existing owner-provided handler capability already expresses the concern (for example
      `materializeCommandArguments`), the concern uses that capability instead of a second table.
    - A record that would pass the line ceiling is split into per-owner partial records, composed with
      `satisfies` against the full mapped type. Every partial record lives in the module that owns
      the concern. The split by action owner is only a file split inside that module, so no import
      edge to the owning modules is added.
    - Narrowing is not a table and stays. That covers a handler narrowing its own action, and code
      narrowing to one specific action that it builds or consumes by contract.

8. **Partial programs.** TypeScript programs that do not include all of `src` never see a truncated
   union. `tsconfig.e2e.json` includes the owners' augmentation files, and `tsconfig.scripts.json`
   does too if it ever names `AppAction`. The first move slice adds the include glob
   `src/modules/*/events/*AppActions.ts` to each. A program may instead avoid naming `AppAction`.

## Transition

No import path changes for the generic contract, so the roughly 745 importers are not rewritten.
The slice order:

- (a) The command-schema generator emits canonical order. This is a one-time regeneration with no
  change in validation behaviour.
- (b) The first move slice introduces `AppActionRegistry` with its `legacy` key. Until the last move slice, `AppActionRegistry` carries one `legacy` key whose value is the
  union of variants not yet moved, declared in `handlerContract.ts` itself.
- (c) Each move slice moves one owner group's variants and the snapshot types only they reference,
  shrinking `legacy`. It rewrites only the importers of the moved named types. It repoints and
  restamps any tracked set that pins a moved variant (decision 6). It also repoints every spec or
  script that reads a moved declaration by file path, found with
  `grep -rl "handlerContract.ts" src scripts tests`; for example
  `src/modules/Arrangement/stores/__tests__/vcaActivationQuarantine.spec.ts`. The first move slice
  adds the partial-program includes.
- (d) The last move slice removes `legacy` and the remaining domain types from `handlerContract.ts`. It also removes `src/utils/handlerContract.ts` from `eslint.size-baseline.mjs` once the file meets every ceiling.
- (e) The lookup-table slices run per concern-owning module and do not wait for the moves, because
  `AppActionType` keeps its path.

Every slice is behaviour-preserving, leaves the tree compiling, and lands as one reviewable pull
request.

## Consequences

- Adding an action means declaring it in its owner's `events/` and answering every per-concern
  lookup. The compiler refuses the build until each answers.
- Each module owns its action language, and `src/utils` stops holding domain types.
- Tier and cycle rules do not change.
- Resolves the question ADR 0007 and the open-decision docket left open about where `AppAction`
  lives and whether it stays the dispatch contract. 0058 replaces 0007's stated `AppAction`
  location, so 0007 is marked superseded in part. `AppAction` stays the canonical dispatch
  contract, composed over the domain-free registry in `src/utils/handlerContract.ts`. The
  `models/AppAction.ts` location in 0007 is no longer current. Only 0007's status line is marked superseded in part. Its body is unchanged.
- Extends 0006 (contract barrels) and 0011 (one language, one owner). Supersedes 0007's `AppAction` location clause.

## Deferred

Not decided here: unifying concerns that several tables encode twice. Examples:

- Which actions mint or target ids. This is encoded separately in Command application-id minting, AI
  batch-local identities, macro playback and AI affected-ids.
- The duplicated `removeClip`/`splitClip` undo command-id rule.
- Prior-batch state projection, spread across Arrangement, MIDI and Automation.

Unifying them changes behaviour, so each needs its own decision.
