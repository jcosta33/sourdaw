# Agent Prompt — Team 4: Session

You are a migration agent assigned to **Team 4: Session**.

## Task file — fill in before any work begins

Your task file has been created for you in this worktree under `agents/tasks/`. Its path was passed to you when this session launched.

Fill in **Objective** and **Plan** before writing any code. Keep it updated throughout:

- **Module checklist** — one entry per module, marked pending / in-progress / done
- **Findings** — architectural issues discovered per module (hidden writes, leaking runtime state, bad boundaries, etc.)
- **Shim contracts** — every public path you shim, so other teams can verify stability
- **Open questions** — anything uncertain that may need cross-team input or human review

Fill in **Handoff** before ending the session. Never leave it empty.

---

## Read these first

Before touching any code, read and internalise:

- `docs/architecture/01-system.md` — system-level invariants
- `docs/architecture/03-typescript-module.md` — TypeScript module anatomy and dependency rules
- `.agents/specs/architecture-refactor/architecture-migration.md` — the staged migration strategy

Relevant skills — apply throughout:

- `.agents/skills/architecture-violations/` — what counts as a real violation vs fake compliance
- `.agents/skills/state-and-write-paths/` — write boundary and ownership rules
- `.agents/skills/manage-task/` — how to keep the task file current

---

## Your modules

Migrate these modules, one at a time, in this order:

1. `Automation`
2. `CrdtDocument`
3. `Collaboration`
4. `MIDI`
5. `Arrangement`

Leave `Arrangement` for last — it is the main project data hub, imported by almost every other module in the codebase, and must be handled with the most care.

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

- `src/modules/Automation/`
- `src/modules/CrdtDocument/`
- `src/modules/Collaboration/`
- `src/modules/MIDI/`
- `src/modules/Arrangement/`

Do not touch any other module's files for any reason.

---

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

## Notes from Team 3 (Instrument Workshop) — 2026-04-04

Team 3 completed its migration first and found the following violations that originate inside **your** modules. These will block `pnpm deps:validate` from passing until resolved.

### Arrangement: 5 violations importing Team 3 private internals

**`Arrangement/repositories/presets/factoryPresets.ts` imports `Fermenter/repositories/fermenterPresets.ts` directly.**
This is a private repository path. A public path already exists: `Fermenter/useCases/fermenterQueries` re-exports `FERMENTER_PRESETS`. Switch the import there — no Team 3 changes needed.

**`Arrangement/models/pluginDescriptors/` imports private model types from 4 Team 3 instruments:**

- `bacteriaDescriptor.ts` → `Bacteria/models/BacteriaPatch.ts`
- `crustDescriptor.ts` → `Crust/models/CrustPatch.ts`
- `glutenDescriptor.ts` → `Gluten/models/GlutenPatch.ts`
- `grinderDescriptor.ts` → `Grinder/models/GrinderPatch.ts`

`models/` is private per the architecture rules. Two options — coordinate with Team 3 before deciding:

1. Team 3 can expose patch types via a thin public barrel (e.g. `useCases/<instrument>Queries/index.ts`) — request this via the shared spec or PR comment.
2. Arrangement can define minimal local descriptor interfaces that structurally match only the fields it needs, without importing the full patch type.

### Arrangement: within-team CrdtDocument violations (internal to Team 4)

These are within your boundary and do not require cross-team coordination:

- `Arrangement/stores/trackStore.ts` → `CrdtDocument/models/CrdtDocumentTypes.ts`
- `Arrangement/stores/takeLaneStore.ts` → `CrdtDocument/models/CrdtDocumentTypes.ts`
- `Arrangement/stores/markerStore.ts` → `CrdtDocument/models/CrdtDocumentTypes.ts`

Fix: expose `CrdtDocumentTypes` via `CrdtDocument/useCases/` or a public models barrel.

### Arrangement/MIDI: violations importing Team 1 private paths

These require Team 1 (Conductor) to expose public paths:

- `Arrangement/useCases/importAudioFile.ts` → `Command/models/UndoEntry.ts` (private)
- `MIDI/useCases/importMidiFile.ts` → `Command/models/UndoEntry.ts` (private)

Coordinate with Team 1 to expose `UndoEntry` via `Command/useCases/` or a public models path.

### MIDI: importing Arrangement private repository (within Team 4)

- `MIDI/useCases/importMidiFile.ts` → `Arrangement/repositories/clipIdCounter.ts`

`repositories/clipIdCounter.ts` is private. Expose it via a use case or public barrel within Arrangement.

### Arrangement view ↔ Workspace component — mutual cross-presentation violation

- `Arrangement/presentations/views/TrackListView.tsx` → `Workspace/presentations/components/MiniMasterSpectrum.tsx`

A view in Arrangement is importing a presentation component from Workspace (Team 5). This is a `no-cross-module-private-presentation` violation. Coordinate with Team 5: either Workspace promotes `MiniMasterSpectrum` to a shared/public component, or Arrangement inlines an equivalent local component.
