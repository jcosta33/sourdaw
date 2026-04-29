# E2E Test Suite Expansion

## Context
With Playwright infrastructure newly integrated, the project currently only has a basic smoke test. We must expand this to cover the core critical paths of the DAW to ensure baseline stability during rapid iteration.

Reference relevant research if any: `.agents/specs/playwright-agent-ui-interaction.md`

---

## Goal
Establish four foundational Playwright E2E test suites covering the transport engine, clip arrangement, project lifecycle, and device routing.

---

## User-visible behavior
- CI pipelines will automatically run a comprehensive suite of tests verifying the core capabilities of the DAW: playing audio, drawing clips, loading templates, and inserting devices.
- Developers receive immediate feedback if a foundational workflow breaks.

---

## Scope

**In scope:**
- Implementing four specific test files in `tests/e2e/`:
  - `transport.spec.ts`
  - `arrangement.spec.ts`
  - `project.spec.ts`
  - `devices.spec.ts`
- Covering the basic "happy path" interactions for each domain.

**Non-goals (explicitly out of scope):**
- Exhaustive testing of every edge case, UI component, or specific audio DSP outcome.
- Visual regression testing (pixel matching).

---

## Requirements

1. **Transport Suite:** Must assert that toggling the global transport (Play/Stop) updates the UI state correctly and that the playhead position progresses when playing.
2. **Arrangement Suite:** Must assert that a user can interact with the timeline grid to instantiate a new clip.
3. **Project Suite:** Must assert the "New Project" flow clears the timeline and that loading an "EDM" or "Ambient" template populates tracks.
4. **Devices Suite:** Must assert that inserting a device (e.g., Yeast or Grinder) via the browser or track context menu successfully adds it to the track chain and updates the UI.

---

## Constraints
- All tests must use robust locators (`getByRole`, `getByTestId`).
- Tests should not rely on hardcoded timeouts (`waitForTimeout`); they must wait for actionable state changes using Playwright assertions (`toBeVisible()`, `toHaveText()`).

---

## Acceptance criteria

<acceptance_criteria>

- [x] `tests/e2e/transport.spec.ts` exists and passes.
- [x] `tests/e2e/arrangement.spec.ts` exists and passes.
- [x] `tests/e2e/project.spec.ts` exists and passes.
- [x] `tests/e2e/devices.spec.ts` exists and passes.
- [x] `pnpm test:e2e` successfully executes all tests.

</acceptance_criteria>

---

## Implementation notes
- Web Audio API requires a user gesture to start. The tests must simulate a click (e.g., on the Play button or a generic "Start" overlay) before asserting engine behavior.
- The DAW utilizes complex canvas/WebGL rendering for some views, so Playwright interactions should target the surrounding HTML interactive elements (buttons, menus) rather than trying to inspect canvas pixels.