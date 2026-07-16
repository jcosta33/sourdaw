---
type: adr
id: 0007
title: Command definitions live in useCases/commands, not models/
status: accepted
date: 2026-07-16
owner: The Sourdaw team
sources:
  - .agents/findings/inventory-decisions-backlog.md
  - .agents/findings/audit-remediation-deferrals.md
---

# 0007 — Command definitions live in useCases/commands, not models/

## Context

The Command module historically kept its command definition files under
`models/Commands/*` (`AiCommands`, `AutomationCommands`, `ClipCommands`,
`EditCommands`, `ElasticCommands`, `MidiCommands`, `MiscCommands`,
`ProjectCommands`, `TrackCommands`, `TransportCommands`, `ViewCommands`). These
files are not pure models: each command carries an imperative `action` callback
that reaches into use cases and stores. Keeping them in `models/` made the
model layer import the use-case/store layer, inverting the intended
UI → use cases → repositories/stores direction and giving the architecture
audit a recurring "relocate the orchestration files out of `models/`" item.

The relocation was executed in commit `818031850` (PR #283, "Refactor Command
model boundaries"). The eleven `models/Commands/*.ts` files moved to
`useCases/commands/*.ts` (PascalCase filenames preserved, e.g.
`useCases/commands/TrackCommands.ts`), `models/CommandRegistry.ts` was removed,
`useCases/commandQueries.ts` (the ~505-line dispatch-contract file) was deleted,
and its `AppAction` dispatch-contract type was consolidated into
`models/AppAction.ts`. A new `presentations/views/commandRegistry.ts` +
`useCases/searchCommandRegistry.ts` carry registry/search. The known-violation
baselines shrank accordingly.

This ADR records that executed decision, which was never captured as a durable
record.

## Decision

Command definition files — the ones that own an imperative `action` orchestrating
use cases and stores — live under `src/modules/Command/useCases/commands/`, not
under `models/`. `models/` holds only pure Command types and data
(`AppAction.ts`, `CommandEntry.ts`, `UndoEntry.ts`, `UndoTree.ts`, `Macro.ts`,
…). The command registry and its search are presentation/use-case concerns
(`presentations/views/commandRegistry.ts`, `useCases/searchCommandRegistry.ts`),
not model concerns.

Validation contracts belong to the command that owns them: e.g.
`useCases/commands/TrackCommands.ts` and `ClipCommands.ts` carry the
rename-input trimming/non-empty checks, not a `models/` type.

## Non-goals

- Do not move pure Command data types (`CommandEntry`, `UndoEntry`, `UndoTree`,
  `Macro`) out of `models/`; only the action-bearing definition files relocate.
- Do not settle here the themed-rename-prompt product question (still open in the
  docket) — that is orthogonal to where the command files live.
- Do not redesign the undo-tree subsystem in this ADR.

## Open questions

- **Retire or keep `models/AppAction.ts`.** `AppAction.ts` remains in `models/`
  and now also carries the dispatch-contract type that `commandQueries.ts`
  previously held (type-imported repo-wide and mirrored by AiRuntime). Whether
  `AppAction` should be retired in favor of the command-registry/query surface,
  or kept as the canonical dispatch contract in `models/`, is still open and
  tracked in `open-decision-docket.md` (Command).
- The write-only undo-tree subsystem (branch switching that is bookkeeping vs
  traverse/replay) remains an open Command question in the docket.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep command definitions in `models/` | They import use cases and stores, so `models/` was importing upward — the exact direction violation the boundary cruises forbid. |
| Split each command into a pure model + a separate use-case action | More files for no boundary benefit; the definition and its action are one unit and belong together in the use-case layer. |
| Move command definitions into `handlers/` | Handlers are the cross-module dispatch mechanism (`createHandler`), not the palette command catalog; conflating them would blur two distinct surfaces. |

## Consequences

- Positive: `models/` is pure again; the Command layer flows
  UI/use cases → stores/repositories without an upward import from models.
- Positive: the recurring audit "relocate `models/commands/*`" item is closed.
- Negative: the `AppAction.ts` ownership question is narrowed but not closed
  (see Open questions).
- Neutral: filenames stayed PascalCase through the move, so cross-references and
  imports track by path only.

## Status

accepted

Records the relocation executed by commit `818031850` (PR #283).

## Follow-up work

Resolve the `models/AppAction.ts` retire-or-keep question (docket, Command) and
decide the fate of the write-only undo-tree subsystem.

## Affected requirements

- Command module layer direction (UI → use cases → stores) in `CLAUDE.md`.
- Closes the audit-remediation "relocate the 11 `models/commands/*` orchestration
  files out of `models/`" spec-level item for the file-location half; the
  `AppAction` home half remains open.
