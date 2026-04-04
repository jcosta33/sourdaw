# Agent Prompt — Team 5: Studio Shell

You are a migration agent assigned to **Team 5: Studio Shell**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/specs/architecture-refactor/task-team5-studio-shell.md
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

## Read these first

Before touching any code, read and internalise:

- `docs/architecture/01-system.md` — system-level invariants
- `docs/architecture/03-typescript-module.md` — TypeScript module anatomy and dependency rules
- `.agents/specs/architecture-refactor/architecture-migration.md` — the staged migration strategy

Relevant skills — apply throughout:

- `.agents/skills/architecture-violations/` — what counts as a real violation vs fake compliance
- `.agents/skills/state-and-write-paths/` — write boundary and ownership rules
- `.agents/skills/ui-patterns/` — presentation layer conventions
- `.agents/skills/manage-task/` — how to keep the task file current

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

---

## What to do for each module

For each module in your list, follow the staged migration process defined in `architecture-migration.md`:

1. Identify current external contract paths (what other modules import from this one)
2. Identify ownership and write problems inside the module
3. Refactor internals toward the target architecture
4. Preserve all old external import paths with thin shims where needed
5. Do not touch any other module's files

The target internal structure for each module is defined in `docs/architecture/03-typescript-module.md`.

---

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

---

## Coordination notes

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

## Notes from Team 3 (Instrument Workshop) — 2026-04-04

Team 3 completed its migration first and found the following violations that originate inside **your** modules. These will block `pnpm deps:validate` from passing until resolved.

### Workspace ↔ Arrangement: mutual cross-presentation violation (coordinate with Team 4)

- `Workspace/presentations/components/MiniMasterSpectrum.tsx` → `Arrangement/presentations/hooks/useTracks.ts`

`presentations/hooks/` is private. A component in Workspace is reaching into Arrangement's private presentation layer. Coordinate with Team 4: either Arrangement exposes track state via a public store/useCase, or Team 4 promotes `useTracks` to a public path. Note: `Arrangement/presentations/views/TrackListView.tsx` also imports `MiniMasterSpectrum` back from Workspace, creating a mutual cross-module presentation dependency — both teams need to resolve this together.

### Workspace: importing SampleLibrary and AiRuntime private internals (within Team 5)

These are violations within your own boundary:

- `Workspace/presentations/hooks/useAppInitialization.ts` → `SampleLibrary/repositories/libraryPersistence.ts`
  Fix: expose a public use case in `SampleLibrary/useCases/` for initialisation, or surface state via the SampleLibrary store.

- `Workspace/presentations/views/Prompt/LlmStatusBadge.tsx` → `AiRuntime/repositories/webLlm/engineLifecycle.ts`
- `Workspace/presentations/views/Prompt/LlmStatusBadge.tsx` → `AiRuntime/models/ModelInfo.ts`
  Both are private paths. `LlmStatusBadge` is also a **component** (not a view), so it should not reach into repositories at all — data must come via props or a public store. Fix: expose engine status via `AiRuntime/stores/` or a public `AiRuntime/useCases/` path, then read from the store in a view and pass down as props.

### SampleLibrary and AiRuntime: internal presentation-layer violations (within Team 5)

- `SampleLibrary/presentations/views/LibraryBrowser.tsx` → `SampleLibrary/repositories/libraryPersistence.ts`
  A view is importing a repository directly. Fix: route via a use case.

- `AiRuntime/presentations/hooks/useVoiceRecording.ts` → `AiRuntime/repositories/voiceTauriAdapter.ts`
  A presentation hook is importing a repository directly. Fix: route via a use case.

### AiRuntime and AiGeneration: importing private paths from Teams 1 and 4 (requires coordination)

These require Teams 1 (Conductor) and 4 (Session) to expose public paths:

- `AiRuntime/useCases/dsoEditor/executeDsoEdit.ts` → `CrdtDocument/repositories/automergeRepository.ts` — request Team 4 to expose a public use case
- `AiRuntime/useCases/dsoEditor/executeDsoEdit.ts` → `Command/models/UndoEntry.ts` — request Team 1 to expose `UndoEntry` publicly
- `AiRuntime/useCases/dsoEditor/compileDso.ts` → `Transport/repositories/transport.ts` — request Team 1 to expose transport access via a public use case
- `AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts` → `Command/models/UndoEntry.ts` — same Team 1 request as above

Raise these as coordination points early. The `dsoEditor` files access CRDT internals and undo/redo internals directly — the right fix is for `CrdtDocument` and `Command` to expose operation-level use cases that AiRuntime can call without knowing internal types.

### Workspace: cross-presentation import from Project (Team 1 violation pointing at you)

- `Project/presentations/views/TemplateChooser.tsx` → `Workspace/presentations/components/SourdawLogo.tsx`

Team 1's `Project` module imports a presentation component from Workspace. This is Team 1's violation to fix, not yours — but you may want to move `SourdawLogo` to a shared location (e.g. `#/components/`) to unblock them. Flag it to Team 1 regardless.
