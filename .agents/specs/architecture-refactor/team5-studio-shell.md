# Agent Prompt — Team 5: Studio Shell

You are a migration agent assigned to **Team 5: Studio Shell**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/tasks/team5-studio-shell.md
```

This file is your live working document for the entire migration. It must exist and be kept up to date throughout. Without it, this work cannot proceed.

Use it to track:
- **Status** — current module being migrated, overall progress
- **Module checklist** — one entry per module, marked pending / in-progress / done
- **Findings** — architectural issues discovered per module (hidden writes, leaking runtime state, bad boundaries, etc.)
- **Shim contracts** — every public path you shim, so other teams can verify stability
- **Open questions** — anything uncertain that may need cross-team input or human review
- **Notes** — anything else relevant to continuity if the agent is interrupted and resumed

Update this file after completing each module and whenever you make a significant finding.

---

## Your modules

Migrate these modules, one at a time, in this order:

1. `Extension`
2. `Knead`
3. `SampleLibrary`
4. `VirtualKeyboard`
5. `AudioAnalysis`
6. `AiGeneration`
7. `AiRuntime`
8. `Workspace`

Leave `Workspace` for last — it imports nearly every module in the codebase and its migration depends on all other teams having stable shim surfaces.

## Instructions

Follow `.agents/tasks/architecture-migration-prompt.md` exactly for each module in turn.
Replace every occurrence of `<MODULE_NAME>` with the module you are currently migrating.
Complete one module fully before starting the next.

## Your boundary

You may only modify files inside:
- `src/modules/Extension/`
- `src/modules/Knead/`
- `src/modules/SampleLibrary/`
- `src/modules/VirtualKeyboard/`
- `src/modules/AudioAnalysis/`
- `src/modules/AiGeneration/`
- `src/modules/AiRuntime/`
- `src/modules/Workspace/`

Do not touch any other module's files for any reason.

## Coordination note

`AiGeneration` and `AiRuntime` have a known circular dependency — they are both in your team deliberately so you can resolve it cleanly without cross-team coordination.

`Workspace` imports from all other teams. Before beginning its migration, verify that Teams 1–4 have stable shim contracts in place. The migration of `Workspace` is primarily about cleaning up its internal presentation/business separation — the key issue is that business logic must not live in views or hooks, and stores must not act as hidden write APIs. Do not attempt to reduce Workspace's import surface as part of this migration; that is a post-convergence concern.

---

## Notes from Team 1 (Conductor) — read before starting

Team 1 migration is complete on branch `agent/arch-migration-team1-conductor`. The following items require action from Team 5.

### 1. `AiRuntime` — update `UndoEntry` import path and fix direct `transportStore` access

- `AiRuntime/useCases/dsoEditor/executeDsoEdit.ts` imports `UndoEntry` from `Command/models/UndoEntry` — a private path. Update to `#/modules/Command/useCases/commandQueries`, where all `UndoEntry` types are now re-exported from the public surface.
- `AiRuntime/useCases/dsoEditor/compileDso.ts` imports directly from `Transport/repositories/transport` — a private path. Update to use Transport's public use cases (`#/modules/Transport/useCases/transportQueries` for reads, or the relevant `transportControls/` use case for writes).

### 2. `AiGeneration` — update `UndoEntry` import path

`AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts` imports `UndoEntry` from `Command/models/UndoEntry` — a private path. Update to `#/modules/Command/useCases/commandQueries`.

### 3. `Workspace` — `SourdawLogo` component

`Project/presentations/views/TemplateChooser.tsx` previously imported `SourdawLogo` from `Workspace/presentations/components/SourdawLogo` — a private path. Team 1 inlined the component as a local copy in `TemplateChooser.tsx` to break the cross-module private dependency. During your `Workspace` migration, consider whether `SourdawLogo` should be promoted to `Workspace/presentations/views/` so it can be shared properly, or whether the duplication is acceptable long-term.
