# E2E Test Suite Expansion: Phase 2

## Context
Following the successful implementation of the foundational E2E test suite (Phase 1) which covered transport, arrangement, project lifecycle, devices, mixer, browser, and MIDI editor, we need to continue expanding our coverage to shield more of the DAW's core workflows. 

## Goal
Establish Phase 2 of the Playwright E2E test suite, focusing on automation, undo/redo history, device panels, and sample library workflows.

## User-visible behavior
- CI pipelines will automatically run an extended suite of tests verifying secondary but critical DAW workflows: drawing automation, navigating the undo history, interacting with complex device panels, and dragging samples from the library.
- Developers receive immediate feedback if these intermediate workflows break.

## Scope

**In scope:**
- Implementing four specific test files in `tests/e2e/`:
  - `automation.spec.ts`
  - `undo.spec.ts`
  - `devicePanels.spec.ts`
  - `library.spec.ts`
- Covering the basic "happy path" interactions for each domain.

**Non-goals (explicitly out of scope):**
- Exhaustive testing of every edge case or every single parameter in every device.
- Visual regression testing (pixel matching).

## Requirements

1. **Automation Suite:** Must assert that a user can toggle automation lanes on a track, switch the automation parameter (e.g., Volume to Pan), and add/move an automation point on the canvas.
2. **Undo/Redo Suite:** Must assert that a user can perform an action (e.g., adding a track or clip), open the History/Collaboration panel, and successfully click the undo button to revert the state.
3. **Device Panels Suite:** Must assert that a user can double-click a device in the device chain (e.g., Grinder or Fermenter) to open its dedicated expanded panel, and interact with a macro or core parameter.
4. **Library Suite:** Must assert that a user can navigate to the Samples tab in the Browser, preview a sample, and initiate a drag toward the timeline.

## Constraints
- All tests must use robust locators (`getByRole`, `getByTestId`).
- Tests should not rely on hardcoded timeouts; use Playwright's auto-retrying `expect` and `waitFor` state changes.

## Acceptance criteria

<acceptance_criteria>

- [ ] `tests/e2e/automation.spec.ts` exists and passes.
- [ ] `tests/e2e/undo.spec.ts` exists and passes.
- [ ] `tests/e2e/devicePanels.spec.ts` exists and passes.
- [ ] `tests/e2e/library.spec.ts` exists and passes.
- [ ] `pnpm test:e2e` successfully executes all tests.

</acceptance_criteria>
