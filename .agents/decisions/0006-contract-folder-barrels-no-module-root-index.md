---
type: adr
id: 0006
title: Contract-folder barrels are the only cross-module surface; no module-root index.ts
status: accepted
date: 2026-07-16
owner: The Sourdaw team
sources:
  - .dependency-cruiser.cjs
  - CLAUDE.md
  - .agents/findings/inventory-decisions-backlog.md
---

# 0006 — Contract-folder barrels are the only cross-module surface; no module-root index.ts

## Context

Early module inventory rounds repeatedly flagged individual modules for
"missing" a module-root `index.ts` and recommended adding one to collapse deep
cross-module imports (Transport, MIDI, Synth, CrdtDocument, Workspace, and a now
superseded Bacteria item all carried this line). That recommendation is
obsolete: the project already migrated to a contract-folder barrel model and
removed module-root barrels entirely.

`.dependency-cruiser.cjs` records the realized state directly: "Each module
exposes up to four independently-importable contract surfaces. There is no
module-root index.ts (0 exist)." The `cross-module-index-only` rule accepts
**only** the contract-folder form `<module>/<contract>/index.ts`; the old
root-barrel form (`<module>/index.ts` or the bare module root) was removed in
Tier 1 and now fails as unresolvable plus a tsgo error. `CLAUDE.md` states the
same rule set: cross-module imports target only `useCases/`, `stores/`,
`events/`, `presentations/views/`; no module-root `index.ts`; no deep imports
into private folders.

The decision was therefore already made and enforced project-wide; it was never
written as an ADR, so stale inventory lines kept re-proposing the reverse. This
record closes the question and supersedes every "add a module-root index.ts"
inventory item.

## Decision

Cross-module code is imported **only** through contract-folder barrels — up to
four per module, each its own `index.ts`:

- `useCases/index.ts`
- `stores/index.ts`
- `events/index.ts`
- `presentations/views/index.ts`

A module creates only the contract folders it actually exposes. There is no
module-root `index.ts` in any module, and one must not be added. Deep imports
into private folders (`models/`, `repositories/`, `handlers/`, `engine/`,
`services/`, …) are forbidden across modules. Same-module code uses relative
imports to the defining file, never the module's own contract barrels.

This is enforced by `pnpm deps:validate` (`cross-module-index-only`,
`module-index-contract-only`, `no-self-barrel-import`, and the
not-to-unresolvable rule for the retired root form) plus tsgo.

## Non-goals

- Do not re-introduce module-root barrels for convenience, aggregation, or to
  shorten an import path.
- Do not add a fifth contract surface; the four barrels are the whole public
  contract vocabulary.
- Do not use this ADR to relocate code between layers — layer direction and
  private-folder rules are governed by the existing boundary cruises, not
  restated here.

## Open questions

None for the barrel model itself. Individual modules still carry unrelated
open decisions (persistence, dead surfaces, ownership) tracked in
`open-decision-docket.md`; those are not barrel questions.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Add a module-root `index.ts` per module re-exporting the contract folders | Re-introduces exactly the legacy shape the Tier-1 migration removed; the `cross-module-index-only`/`no-self-barrel-import` rules forbid it, and importers already route through contract-folder barrels, so it adds a redundant surface for zero benefit. |
| Allow deep imports into private folders when "convenient" | Erases the public/private boundary the validator enforces and lets internal refactors break foreign modules. |
| A single aggregated barrel per module (root only, no contract folders) | Collapses the four independently-importable surfaces into one, coupling consumers to unrelated parts of a module and defeating the type/reachability cruises. |

## Consequences

- Positive: the public surface of every module is exactly its contract folders;
  private folders are free to change without breaking consumers, and the
  migration state is now documented rather than re-litigated by aging inventory.
- Positive: closes six stale "no root index.ts" inventory items in one record.
- Negative: consumers must import from the specific contract folder rather than a
  single module entrypoint (accepted; it is the point of the boundary).
- Neutral: modules that expose fewer than four surfaces simply omit the unused
  contract folders.

## Status

accepted

Records a decision already realized and enforced project-wide.

## Follow-up work

None required. New modules follow the contract-folder pattern by default; the
`deps:validate` gate rejects any regression to a module-root barrel.

## Affected requirements

- Architecture boundary rules in `CLAUDE.md` ("Contract barrels only
  cross-module") — this ADR is their durable rationale.
- Supersedes the "add a module-root index.ts" inventory items for Transport,
  MIDI, Synth, CrdtDocument, Workspace, and Bacteria.
