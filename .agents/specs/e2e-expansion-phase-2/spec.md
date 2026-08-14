---
type: spec
id: SPEC-e2e-expansion-phase-2
title: E2E test suite expansion phase 2
status: draft
owner: The Sourdaw team
sources:
  - ../e2e-expansion/spec.md
---

# E2E test suite expansion phase 2

## Intent

Extend the Playwright E2E suite beyond the phase-1 core workflows (transport, arrangement, project
lifecycle, devices, mixer, browser, MIDI editor) to cover four secondary-but-critical workflows —
automation editing, undo/redo history, device panels, and the sample library — so targeted local checks give
developers immediate feedback when these intermediate paths break.

## Non-goals

- Exhaustive coverage of every edge case or every device parameter.
- Visual-regression (pixel-matching) testing.

## Requirements

### AC-001 — Automation suite covers lane, parameter, and point editing

`tests/e2e/automation.spec.ts` must assert that a user can toggle an automation lane on a track,
switch the automated parameter (e.g. Volume to Pan), and add then move an automation point on the
canvas.

Verify with: `pnpm test:e2e automation`

### AC-002 — Undo suite covers a perform-then-revert round trip

`tests/e2e/undo.spec.ts` must assert that a user can perform an action (add a track or clip), open
the History panel, and click undo to revert the state.

Verify with: `pnpm test:e2e undo`

### AC-003 — Device-panels suite covers open and interact

`tests/e2e/devicePanels.spec.ts` must assert that a user can double-click a device in the chain
(e.g. Grinder or Fermenter) to open its expanded panel and interact with a macro or core parameter.

Verify with: `pnpm test:e2e devicePanels`

### AC-004 — Library suite covers navigate, preview, and drag

`tests/e2e/library.spec.ts` must assert that a user can open the Samples tab in the Browser,
preview a sample, and initiate a drag toward the timeline.

Verify with: `pnpm test:e2e library`

### AC-005 — Tests use robust locators and auto-retrying assertions

All four suites must use role/testid locators (`getByRole`, `getByTestId`) and Playwright
auto-retrying `expect`/`waitFor` with no hardcoded timeouts, and pass independently.

Verify with: the focused commands in AC-001 through AC-004

## Open questions

- [ ] (non-blocking) Are stable `data-testid`s present on the History panel, device-expand control,
  and Samples-tab drag source, or do they need to be added alongside the tests?

## Affected areas

- `tests/e2e/library.spec.ts` (new) and `tests/e2e/devicePanels.spec.ts` (extend: the existing
  file covers the Inspector toggle, not device-expand). `automation.spec.ts` and `undo.spec.ts`
  already cover AC-001/AC-002.
- possibly `data-testid` attributes on the device-expand control and Samples-tab drag source

## Dropped from sources

- Nothing — the source maps cleanly to one suite-expansion feature.
