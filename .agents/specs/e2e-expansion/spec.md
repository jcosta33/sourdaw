---
type: spec
id: SPEC-e2e-expansion
title: Foundational E2E test suites
status: done
owner: The Sourdaw team
sources:
  - self
---

# Foundational E2E test suites

## Intent

Cover the DAW's core critical paths with four foundational Playwright E2E suites — transport,
arrangement, project lifecycle, and device routing — so a broken foundational workflow fails
targeted local verification.

## Non-goals

- Exhaustive testing of every edge case, UI component, or DSP outcome.
- Visual regression (pixel matching).

## Requirements

### AC-001 — Transport suite verifies play/stop and playhead

The transport suite must assert that toggling play/stop updates the UI state and that the
playhead position advances during playback.

Verify with: `pnpm test:e2e -- tests/e2e/transport.spec.ts`

### AC-002 — Arrangement suite instantiates a clip

The arrangement suite must assert that interacting with the timeline grid instantiates a new
clip.

Verify with: `pnpm test:e2e -- tests/e2e/arrangement.spec.ts`

### AC-003 — New Project clears the timeline

The project suite must assert that the New Project flow clears the timeline.

Verify with: `pnpm test:e2e -- tests/e2e/project.spec.ts`

### AC-004 — Templates populate tracks

The project suite must assert that loading an EDM or Ambient template populates tracks.

Verify with: `pnpm test:e2e -- tests/e2e/project.spec.ts`

### AC-005 — Device insertion updates the chain

The devices suite must assert that inserting a device (e.g. Yeast or Grinder) via the browser
or the track context menu adds it to the track chain and updates the UI.

Verify with: `pnpm test:e2e -- tests/e2e/devices.spec.ts`

### AC-006 — Each foundational suite executes independently

Each foundational suite must execute alone against a managed dev server.

Verify with: the focused commands in AC-001 through AC-005

### AC-007 — Engine-behavior assertions are preceded by a user gesture

Because the Web Audio API only starts after a user gesture, any suite asserting engine
behavior must first simulate a click (e.g. the Play button or a generic "Start" overlay)
before asserting that the engine has started.

Verify with: `pnpm test:e2e -- tests/e2e/transport.spec.ts`

### AC-008 — Interactions target HTML elements, not canvas pixels

Because some DAW views render through canvas/WebGL, suites must drive interactions through the
surrounding HTML interactive elements (buttons, menus).

Verify with: `manual` — inspect the four affected suite files

### AC-009 — Suites do not assert against canvas pixels

Because some DAW views render through canvas/WebGL, suites must never assert against canvas
pixels.

Verify with: `manual` — inspect the four affected suite files

## Open questions

- [ ] None.

## Affected areas

- `tests/e2e/transport.spec.ts`
- `tests/e2e/arrangement.spec.ts`
- `tests/e2e/project.spec.ts`
- `tests/e2e/devices.spec.ts`

## Dropped from sources

- Edge-case and DSP-outcome coverage — deliberately deferred; these suites cover happy-path workflows only.
- Visual regression — out of scope; coverage targets DOM state, visibility, and behavior.
- Robust-locator and no-hardcoded-timeout conventions — authoring discipline rather than per-suite acceptance criteria.
