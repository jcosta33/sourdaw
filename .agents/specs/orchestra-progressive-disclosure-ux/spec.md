---
type: spec
id: SPEC-orchestra-progressive-disclosure-ux
title: Orchestra progressive-disclosure UI
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra progressive-disclosure UI

## Intent

Give Orchestra one UI where complexity is always available but never forced: a
stable five-zone layout with selectable complexity levels (Play through Lab) that
reveal depth in place, so a composer lives in macros and articulation switching
while an engineer reaches every mic, legato, and modeling control without a mode
switch.

## Non-goals

- The DSP behaviors the UI controls — owned by the engine specs (`SPEC-orchestra`
  and its articulation/expression/legato/mic/reverb siblings).
- The DAW-level orchestral template system — owned by
  `SPEC-orchestra-daw-integration`.
- Multi-instance window management — owned by `SPEC-levain-multi-instance`.

## Requirements

### AC-001 — The layout stays stable while selection drives detail

When the user selects an instrument, articulation, or mic, the center inspector
must update to that item while the five zones (top bar, left stack, center
inspector, bottom dock, right mixer) keep their positions.

Verify with: `pnpm test:run -- OrchestraLayout`

### AC-002 — The complexity level governs which controls are visible

When the complexity level changes (Play → Shape → Build → Arrange → Route → Lab),
the visible control set must match that level's defined surface within one
shared patch.

Verify with: `pnpm test:run -- OrchestraComplexityLevels`

### AC-003 — Level 1 exposes only musical-label controls

When the UI is at Level 1 (Play), only musical-label controls (macros,
articulation indicator, preset browser) must be visible and engine-internal
controls hidden.

Verify with: `pnpm test:run -- OrchestraPlayLevel`

### AC-004 — The macro strip maps to engine parameters

When a macro knob (Dynamics, Expression, Vibrato, Space, …) is moved, it must
drive its mapped engine parameter audibly.

Verify with: `manual` — at Play level, move each macro and confirm an audible change

### AC-005 — The active articulation is always shown

When the active articulation changes by any method, the persistent articulation
indicator must update to reflect it at every complexity level.

Verify with: `pnpm test:run -- OrchestraArticulationIndicator`

### AC-006 — The UI module imports no other module's internals

When the Orchestra UI renders, it must not import internals of other modules.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Onboarding entry points (Play an Orchestra / Build an
  Ensemble / Open Full Instrument) — ship all three at v1 or start with Play?
- [ ] (non-blocking) Which expert fast-paths (keyboard search, A/B compare,
  alt-drag copy) are v1 versus later?

## Affected areas

- `src/modules/Levain/presentations/views/` (five-zone layout, level switcher,
  inspector, macro strip, mic mixer panel)
- `src/modules/Levain/presentations/` (selection-driven detail wiring)

## Dropped from sources

- The full per-level visible/hidden control inventories — design guidance
  realized through AC-002/AC-003; not restated control by control.
- Beginner onboarding card copy and seating diagrams — content/visual design, not
  behavioral requirements.
