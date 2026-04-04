# Agent Prompt — Team 4: Session

You are a migration agent assigned to **Team 4: Session**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/tasks/team4-session.md
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

1. `Automation`
2. `CrdtDocument`
3. `Collaboration`
4. `MIDI`
5. `Arrangement`

Leave `Arrangement` for last — it is the main project data hub, imported by almost every other module in the codebase, and must be handled with the most care.

## Instructions

Follow `.agents/tasks/architecture-migration-prompt.md` exactly for each module in turn.
Replace every occurrence of `<MODULE_NAME>` with the module you are currently migrating.
Complete one module fully before starting the next.

## Your boundary

You may only modify files inside:
- `src/modules/Automation/`
- `src/modules/CrdtDocument/`
- `src/modules/Collaboration/`
- `src/modules/MIDI/`
- `src/modules/Arrangement/`

Do not touch any other module's files for any reason.

## Coordination note

`Arrangement` and `AudioEngine` (owned by Team 2) have a known circular dependency.
Before migrating `Arrangement`, grep for every import from `AudioEngine` inside `Arrangement/` and confirm that Team 2 has shimmed those paths (or that the paths are unchanged).
Do not move any `Arrangement` export that `AudioEngine` currently imports without adding a shim first.

Wait for Teams 1 and 2 to have stable shim contracts before beginning `Arrangement`.

---

## Notes from Team 1 (Conductor) — read before starting

Team 1 migration is complete on branch `agent/arch-migration-team1-conductor`. The following items require action from Team 4.

### 1. `CrdtDocument` — promote `CrdtDocumentTypes` and `automergeRepository` to public surface

Several Team 1 stores (`Transport/stores/transportStore`, `tempoMapStore`, `timeSignatureMapStore`, `Routing/stores/sidechainStore`, `Project/stores/projectStore`, `arrangementStore`) previously imported `DOC_PREFIX_ROOT` from `CrdtDocument/models/CrdtDocumentTypes` — a private path. Team 1 inlined the constant (`const DOC_PREFIX_ROOT = 'root'`) with a comment marking it for promotion.

**Action required:** In your `CrdtDocument` migration, promote `DOC_PREFIX_ROOT` (and any other types from `CrdtDocumentTypes` needed cross-module) to `CrdtDocument`'s public surface (`useCases/` or `stores/`). Once done, the inline constant in each Team 1 store should be replaced with the canonical import.

Additionally, `Command/useCases/executeAppAction.ts` performs a dynamic import of `CrdtDocument/repositories/automergeRepository` to call `restoreSnapshot`. This is a private-repository import. **CrdtDocument must expose a `restoreSnapshot` use case** so Command can call it through the public surface instead.

### 2. `MIDI` — update `UndoEntry` import path

`MIDI/useCases/importMidiFile.ts` imports `UndoEntry` from `Command/models/UndoEntry` — a private path.

**Action required:** Update the import to `#/modules/Command/useCases/commandQueries`, where all `UndoEntry` types (`UndoEntry`, `ActionUndoEntry`, `CallbackUndoEntry`, `UndoSource`, `createUndoEntry`, `createCallbackUndoEntry`, `isActionEntry`) are now re-exported from the public surface.

### 3. `Arrangement` — update `UndoEntry` import path and fix direct `transportStore.set()`

- `Arrangement/useCases/importAudioFile.ts` imports `UndoEntry` from `Command/models/UndoEntry` — update to `#/modules/Command/useCases/commandQueries`.
- `Arrangement/presentations/hooks/useTimelineInteractions.ts` calls `transportStore.set()` directly (line 229) instead of using Transport's `toggleLoop()` use case. Fix this in your Arrangement migration.

### 4. `CrdtDocument/projectProjection.ts` — use exposed hydration use case

`CrdtDocument/useCases/projection/projectProjection.ts` imports `sidechainStore` directly from `Routing/stores/sidechainStore` and calls `store.hydrate()`. Team 1 has exposed `hydrateSidechainRoutes()` at `#/modules/Routing/useCases/hydrateSidechainRoutes`. Update `projectProjection.ts` to call that use case instead of importing the store directly.
