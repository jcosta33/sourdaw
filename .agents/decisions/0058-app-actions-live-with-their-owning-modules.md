---
type: adr
id: 0058
title: App actions live with their owning modules; the contract kernel lives in Command
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

# 0058 - App actions live with their owning modules

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

1. **Kernel home of the contract.** The generic handler contract, `createHandler` and the action
   registry live in the Command module's `events/` folder and are exported from
   `#/modules/Command/events`. Command owns dispatch through `executeAppAction`, and `events/` is the
   only contract barrel that may carry types. Handler maps stay registered in `src/app/bootstrap.ts`
   through `getProductionCommandHandlerMaps`, and every mutation still goes through
   `executeAppAction`.

2. **Composed union.** Command declares `interface AppActionRegistry {}`, with
   `AppAction = AppActionRegistry[keyof AppActionRegistry]` and `AppActionType = AppAction['type']`.
   Each owning module declares its variants in its own `events/` folder, in files named
   `<area>AppActions.ts`, each within the 600-line ceiling. Each such file exports its sub-union and
   adds exactly one registry key through module augmentation
   (`declare module '#/modules/Command/events' { interface AppActionRegistry { ... } }`).
   Reason: the owner-to-Command edge points down to the kernel. Command imports no domain module, so
   composing the union adds no module edge and no cycle. Interface augmentation is the TypeScript
   mechanism for an open, compiler-checked registry, and it was verified to merge through the barrel
   with tsc 7.

3. **Ownership oracle.** An action belongs to the module whose `get<Module>Handlers` map registers
   its handler. That set is the one `getProductionCommandHandlerMaps` returns.

4. **Payload and snapshot types.** A shared snapshot type lives with the module that owns its
   concept. The exception is a type referenced by an action of a lower-tier module, or of a module
   the tier manifest would put in an unaccepted cycle. Then it lives in the lowest-tier referencing
   module, as that module's own structural snapshot. No placement may add an upward edge or a cycle
   outside `allowedCycles` in `.dependency-cruiser.module-tiers.cjs`. If a type cannot be placed under
   this rule, the slice stops, and this ADR is amended in its own pull request before the slice
   continues.

5. **`src/utils` holds no domain types.** `handlerContract.ts` is deleted in the last slice.
   Utilities whose only purpose is the moved types move with them: `createHandler`, and the tempo
   audio-source promotion helpers that read snapshot types.

6. **Shape preservation.** No action, payload or snapshot changes shape during the moves. Undo
   inverses, `describe()` projections and persisted history therefore stay valid. The command
   argument schema generator emits a canonical order, so moving a variant between files leaves the
   generated `src/modules/Command/useCases/versionedCommandArgumentKeys.ts` unchanged except for its
   import line. Any other diff in that file during a move slice means a shape changed, and it blocks
   the slice. Release-inventory digests move only because tracked paths move. The agent evidence
   manifest does not move.

7. **Per-action behaviour is one exhaustive lookup per concern.** Code that derives a property of
   each action by enumerating action types with a default branch is a lookup table. Examples are a
   label, affected ids, a policy, a guard, a replay rule, or membership in a set. Such a table
   becomes one record keyed by every `AppActionType`. Use a mapped type, so each entry receives its
   narrowed action and an action without an entry fails to compile. The record lives in the module
   that owns the concern, Command included for kernel concerns.
   - When an existing owner-provided handler capability already expresses the concern (for example
     `materializeCommandArguments`), the concern uses that capability instead of a second table.
   - A record that would pass the line ceiling is split into per-owner partial records, composed with
     `satisfies` against the full mapped type.
   - Narrowing is not a table and stays. That covers a handler narrowing its own action, and code
     narrowing to one specific action that it builds or consumes by contract.

8. **Partial programs.** TypeScript programs that do not include all of `src` (the scripts and e2e
   projects) include the owners' `events/*AppActions.ts` files, or avoid naming `AppAction`. They
   never see a truncated union.

## Transition

`src/utils` may not import modules, and every dependency-cruiser baseline is empty. No re-export shim
may stay at the old utils path, because it would be new boundary debt. The slice order:

- (a) The command-schema generator emits canonical order. This is a one-time regeneration with no
  change in validation behaviour.
- (b) The generic contract, `createHandler` and the registry move to Command `events/`. Their
  importers are rewritten once. During the transition the registry carries one `legacy` key whose
  value is the not-yet-moved union. Command imports that union from `src/utils/handlerContract.ts`,
  which is allowed because a module may import utils.
- (c) Each following slice moves one owner group's variants and snapshot types, and rewrites only the
  importers of the moved named types. The `legacy` key shrinks each time.
- (d) The last move slice deletes `handlerContract.ts` and the `legacy` key, and updates the scripts
  and e2e programs.
- (e) The lookup-table slices run once per concern-owning module, after (b) has landed.

Every slice is behaviour-preserving, leaves the tree compiling, and lands as one reviewable pull
request.

## Consequences

- Adding an action means declaring it in its owner's `events/` and answering every per-concern
  lookup. The compiler refuses the build until each answers.
- Each module owns its action language, and `src/utils` stops holding domain types.
- Tier and cycle rules do not change.
- Extends 0006 (contract barrels) and 0011 (one language, one owner). Supersedes none.

## Deferred

Not decided here: unifying concerns that several tables encode twice. Examples:

- Which actions mint or target ids. This is encoded separately in Command application-id minting, AI
  batch-local identities, macro playback and AI affected-ids.
- The duplicated `removeClip`/`splitClip` undo command-id rule.
- Prior-batch state projection, spread across Arrangement, MIDI and Automation.

Unifying them changes behaviour, so each needs its own decision.
