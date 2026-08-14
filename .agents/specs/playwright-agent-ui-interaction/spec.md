---
type: spec
id: SPEC-playwright-agent-ui-interaction
title: Playwright agent UI interaction system
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Playwright agent UI interaction system

## Intent

Establish a Playwright structure that serves both maintained E2E tests and ephemeral,
agent-authored scripts that drive the live app and scrape DOM/visual state to stdout — so
agents can investigate the running UI, not only assert against it.

## Non-goals

- Migrating existing Vitest unit or integration tests to Playwright.
- Implementing feature-level UI interactions (this is infrastructure only).
- Visual regression (pixel matching).

## Requirements

### AC-001 — Playwright manages the dev server

`playwright.config.ts` must boot and manage the local dev server via its `webServer`
configuration.

Verify with: `pnpm test:e2e -- tests/e2e/smoke.spec.ts`

### AC-002 — A guarded smoke test passes in tests/e2e

A smoke test under `tests/e2e/` must pass via the `test:e2e` script.

Verify with: `pnpm test:e2e -- tests/e2e/smoke.spec.ts`

### AC-003 — Agent scripts live in a separate directory

Agent investigation scripts must reside in `.agents/ui-scripts/`, separate from `tests/e2e/`.

Verify with: `manual` — confirm `.agents/ui-scripts/` exists with a sample investigation script

### AC-004 — Agent scripts emit structured stdout

A sample agent script run via `npx tsx` must print structured output (JSON or formatted
text), including paths to captured screenshots.

Verify with: `manual` — run the sample script and read its structured stdout and screenshot path

### AC-005 — Tests and scripts use robust locators

Both tests and scripts must use role/testid locators (`getByRole`, `getByTestId`) rather than
brittle DOM selectors.

Verify with: `manual` — review tests and scripts for `getByRole`/`getByTestId` usage

### AC-006 — No cross-module internal imports

This infrastructure must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-007 — Agent usage documented

Documentation (in `AGENTS.md` or a new skill) must detail how agents use this system for UI
investigations, including guidelines for structuring ad-hoc interaction scripts to maximize
reliability and produce useful output. This documentation is required.

Verify with: `manual` — confirm `AGENTS.md` (or a new skill) documents how agents use the system and how to structure ad-hoc interaction scripts

### AC-008 — Agent scripts run fast and clean up browser processes

Agent interaction scripts must execute quickly and cleanly tear down their browser processes
so they never leak browser processes into the agent's environment. This is mandatory.

Verify with: `manual` — run a sample agent script and confirm no orphaned browser processes remain afterward (e.g. `pgrep -f chromium` returns nothing the script spawned)

### AC-009 — Non-blocking for normal development workflows

The Playwright system must remain non-blocking for normal development workflows: its presence
must not gate or slow the standard dev/test loop.

Verify with: `manual` — confirm the standard dev/test workflow runs unaffected when Playwright is present but not invoked

## Open questions

- [ ] (non-blocking) Provide a unified agent helper library (auth, app-state reset) for interaction scripts?
- [ ] (non-blocking) Keep a persistent CDP/WebSocket browser to speed sequential agent runs, or accept per-script headless launch overhead?
- [ ] (restored detail) Directory separation rejected mixing agent scripts into `tests/e2e/` (would bloat the test runner) and rejected forcing the `@playwright/test` runner for ad-hoc investigations (adds overhead, formats output for humans/reporters, harder for agents to scrape arbitrary JSON/plain text) — keep this rationale if AC-003/AC-004 are ever revisited.

## Known risks

- Speed: launching a full headless browser is significantly slower than running Vitest; agents may over-rely on UI investigations when a unit test would be faster and more appropriate — prefer unit tests where they suffice (informs AC-009, `playwright.config.ts`).
- Fragility: agents may write brittle scripts that depend on exact DOM structures; mitigation is to heavily enforce semantic HTML and testing-library-style locators (relates to AC-005, `.agents/ui-scripts/`).

## Affected areas

- `playwright.config.ts`
- `tests/e2e/` (guarded smoke test)
- `.agents/ui-scripts/utils.ts` (`setupAgentBrowser` helper + sample script)

## Dropped from sources

- Migrating Vitest tests to Playwright — Vitest remains the unit/integration suite; Playwright is additive.
- Feature-level interaction implementations — this spec ships infrastructure only.
- Visual regression — out of scope; focus is DOM state and behavior.
