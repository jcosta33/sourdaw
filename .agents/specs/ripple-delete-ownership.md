# Ripple Delete Ownership Refactor

## Context

`Workspace/useCases/rippleEditing.ts` currently owns both the ripple-editing UI toggle and the clip/track mutation logic for ripple deletes. That creates a bidirectional `Workspace <-> Arrangement` dependency through module barrels, which surfaced as an ESM initialization crash when `Arrangement` transitively imported `Workspace` and `rippleEditing.ts` eagerly touched Arrangement exports at module load.

Relevant architectural grounding:

- `docs/architecture/01-system.md` §4.4: shared visibility is not shared ownership
- `docs/architecture/03-typescript-module.md` §3.3 and §4.4: module boundaries are ownership boundaries and use cases are the write surface
- `.agents/skills/architecture-violations/SKILL.md`: fixes must improve ownership rather than cosmetically bypass cycles

## Goal

Ripple-delete planning and track/clip mutation live in Arrangement, while Workspace retains only the ripple-editing UI state and toggle action.

## User-visible behavior

Toggling ripple editing in the transport bar still enables and disables ripple delete behavior. Deleting and undoing deleted clips behave the same as before, but the initialization crash caused by the cross-module cycle no longer occurs.

## Scope

**In scope:**

- Move ripple-delete plan/apply/undo use cases out of Workspace and into Arrangement
- Update cross-module exports/imports and handler call sites to match the new ownership
- Add regression coverage for the prior initialization-cycle failure

**Non-goals (explicitly out of scope):**

- Redesign the ripple-editing UI or the workspace preference itself
- Broader DI framework changes such as adding lazy dependency resolution primitives
- Unrelated architecture cleanup in Arrangement or Workspace

## Requirements

1. Arrangement must own the ripple-delete write path: planning, applying the clip shift, and undoing that change.
2. Workspace must own only the ripple-editing UI state and the action that toggles it.
3. No Arrangement handler or use case may depend on `Workspace` ripple-delete use cases after the refactor.
4. The refactor must remove the module-initialization cycle that previously caused `Cannot access 'getTrackStoreState' before initialization`.
5. Cross-module imports must continue to use module root barrels only; intra-module imports must remain relative.

## Constraints

- Must preserve the existing ripple delete and undo behavior.
- Must follow `AGENTS.md` module-boundary and ownership rules.
- Must avoid introducing new barrel files or compatibility shims.
- Must pass `pnpm deps:validate` with zero violations.

## Design decisions

### Decision: Move ripple-delete orchestration to Arrangement

**Chosen:** `planRippleDelete`, `rippleDeleteClips`, and `undoRippleDelete` will live in Arrangement because they operate on Arrangement-owned track/clip truth.

**Considered and rejected:**

- Keep the logic in Workspace and make DI lazy enough to hide the cycle: rejected because it preserves the ownership leak and only masks the architectural problem.
- Keep the logic in Workspace but pass Arrangement callbacks in from callers: rejected because it still leaves Workspace defining Arrangement’s write behavior.

### Decision: Arrangement may read the Workspace ripple flag

**Chosen:** Arrangement ripple-delete use cases may read `getWorkspaceState()` as cross-module input while owning the track mutation locally.

**Considered and rejected:**

- Pass `rippleEnabled` through every caller: rejected because the flag already has a stable read surface in Workspace and the write ownership, not the read access, is the real issue here.

## Acceptance criteria

- [ ] `Workspace/useCases/rippleEditing.ts` exports only Workspace-owned behavior for the ripple toggle
- [ ] Arrangement owns ripple-delete plan/apply/undo use cases; they are exported from the module root only if an external module needs them
- [ ] Arrangement handlers use Arrangement-owned ripple-delete use cases via relative imports
- [ ] A regression test covers importing Workspace through an Arrangement consumer without initialization failure
- [ ] `pnpm test:run src/modules/Workspace/useCases/rippleEditing.spec.ts` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm deps:validate` passes with zero violations

## Implementation notes

- Reuse the existing `getWorkspaceState` use case from Workspace as the read seam for the ripple flag.
- Keep `RippleDeletePlan` local to Arrangement after the move; do not keep it exported from Workspace.
- Update only the call sites that currently reach ripple delete via `#/modules/Workspace`.

## Test plan

- [ ] Import an Arrangement consumer and then `#/modules/Workspace` in a regression test; confirm the import resolves.
- [ ] Run `pnpm test:run src/modules/Workspace/useCases/rippleEditing.spec.ts`
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm deps:validate`

## Open questions

- [x] **[MINOR]** Should Arrangement read the ripple flag directly or receive it from callers? Resolved in favor of reading `getWorkspaceState()` because it preserves ownership without widening caller responsibilities.

## Tradeoffs and risks

- Arrangement now has a read dependency on Workspace state for the ripple flag. That is acceptable under the architecture rules, but the dependency must remain read-only.
- If additional clip-editing behaviors also depend on Workspace state, the module boundary can become muddier again; future work should keep ownership centered on Arrangement write paths.
