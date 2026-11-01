---
name: test-design
description: >-
    Design tests that observe their claimed subject and fail when it breaks.
    ALWAYS apply when writing or changing an assertion, a spec's setup, fixture or
    waiting logic, a Vitest or Playwright case, or a Rust test, and when reviewing
    whether a test observes what its name claims — even if the change looks like a
    one-line tweak to an existing spec. Skip questions of where a spec file lives
    (testing-file-layout), driving the live UI ad hoc (playwright-ui-bridge), and
    production code with no test change.
---

## Purpose

A green test is evidence only when it would have gone red had the subject broken. This skill covers what a test asserts, what it waits on, what it doubles, and how its run is read. File placement, import paths and the red-first workflow belong to `testing-file-layout`; seams and harness choice are detailed in `docs/06-testing.md`.

## Core rules

### 1. A test must fail when its subject breaks

Name the mutation that turns the case red: revert the behavioural hunk or apply one targeted change, then run the named spec. A case that stays green under that mutation observes nothing.

**Why:** a pass alone is not evidence; the baseline posture in root `AGENTS.md` (Review) requires the mutation probe.

**Enforced by:** the reviewer's mechanical probe through `pnpm guard --profile focused -- pnpm test:run <spec>`.

### 2. Assert the observable the claim names

Assert the output value, the emitted event, the written document state or the rendered text, and not an intermediate the subject could skip. A call on a double is the observable only when the claim is that call to a doubled external system (an engine node's `connect` or `setTargetAtTime`, an `eventBus.emit`, as in `docs/06-testing.md` §5 and §6.11); then prefer asserting its arguments over its mere occurrence. Assert ownership and non-effects (a stale completion must not revive retired state) when they are part of the claim.

**Why:** a bare call-count assertion stays green when the subject is rewired to a different route that produces the wrong result.

**Enforced by:** review only; `docs/06-testing.md` §1 "Observe the outcome".

### 3. Await observable completion

Wait on a resolved promise, an emitted event, a store state, `vi.waitFor`, `expect.poll` or Playwright locator auto-wait. Never a fixed sleep, `page.waitForTimeout`, or a counted number of microtask flushes. Control the completion explicitly in the test.

**Why:** a fixed delay passes on a fast machine and races on a loaded runner, and a flush count encodes an implementation detail.

**Enforced by:** review only; `docs/06-testing.md` §1 forbids fixed microtask counts.

### 4. No conditional admission

A UI case never wraps its body in `if (await locator.isVisible().catch(() => false))`. A missing entry point fails the case. The probe is to remove or rename the entry point and confirm the case goes red.

**Why:** a case whose whole body sits in the branch reaches its end without an assertion when the control is absent (#4441).

**Enforced by:** the baseline probe in root `AGENTS.md` (Review); the `isVisible()` guard class is catalogued in `.agents/skills/review-stances/test-validity.md`.

### 5. Fixtures must discriminate

Choose inputs that a plausible wrong implementation fails. Use unsorted distinct values for an order statistic, unequal frame counts for an accumulation, and competing rows for a carry or tolerance rule. Include the cases that must stay rejected when loosening a validator.

**Why:** sorted, equal or lone inputs let the wrong algorithm return the same answer.

**Enforced by:** review only; the mutation probe of rule 1 exposes a non-discriminating fixture.

### 6. Double only external systems

Replace hardware, OS I/O, hosted services and the desktop bridge. Keep the real collaborators the asserted behaviour depends on: action routing, Automerge authority, history, store projection, real event and `AppError` values. A mocked `AudioContext` proves requested parameters, not rendered sound or latency.

**Why:** a double of the thing under test asserts the double.

**Enforced by:** review only; seams in `docs/06-testing.md` §1, §2 and §5 (`injectDependencies` and `spy` from `src/infra/di/testing/`).

### 7. Reproduce a defect with a red test before the fix

See `testing-file-layout` rule 2. The red output and the mutation of rule 1 are the same evidence seen from two ends.

### 8. Timing specs assert frames, not wall-clock time

For transport, scheduling and automation, assert frame or sample positions and pin the boundary: the loop seam, the block edge, the frame a suspended context resumes on. Schedule against an exactly encoded frame, never the raw `currentTime` quotient.

**Why:** wall-clock time varies by machine; the sample on which a change takes effect is the contract.

**Enforced by:** the `audio-param-frame-timing` reviewer stance, `.agents/skills/review-stances/audio-param-frame-timing.md`.

### 9. Run through the wrapper and the guard

Maintained E2E lives in `tests/e2e/`, asserts user-visible outcomes, and runs with one Playwright worker (`playwright.config.ts`). Commands:

```bash
pnpm guard --profile focused -- pnpm test:run <spec>
pnpm guard --profile broad -- pnpm test:e2e <spec>
```

Use `pnpm test:run` for every probe, never bare `vitest run`.

**Why:** `scripts/runVitestZeroTestGuard.ts` fails a run that collected no case or executed no assertion; bare Vitest exits zero.

**Enforced by:** `pnpm test:run`, `pnpm guard` and `playwright.config.ts`.

### 10. A check can pass without observing

Read what the run executed, not its exit code. A `cargo test <filter>` that matches nothing exits 0, so check the `running N tests` line. Never grep linter output to decide pass or fail; use the exit code. Under `set -o pipefail`, `grep -q` can fail a healthy producer on SIGPIPE; capture first, then match. `pnpm guard` prints no child output on success, so add `--show-output` and require the tool's own summary (`Test Files`, `Tests`, `test result:`).

**Why:** each of these reports green while observing nothing.

**Enforced by:** `scripts/runVitestZeroTestGuard.ts` for Vitest only; review only for cargo, shell and linter checks.
