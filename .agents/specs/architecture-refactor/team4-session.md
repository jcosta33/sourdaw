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
