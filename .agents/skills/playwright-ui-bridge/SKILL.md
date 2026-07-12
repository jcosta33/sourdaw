---
name: playwright-ui-bridge
type: agent-guide
description: >-
  Drive the live application UI through ad-hoc Playwright scripts to inspect DOM state, interact with a flow, or capture screenshots. ALWAYS apply this skill when you need to verify how the app renders visually, inspect runtime DOM or layout too dynamic for static reading, or click through a stateful flow to debug it — even if the prompt only says "look at the UI" or "check the screen". Do not add files under `tests/e2e/`, invoke the `playwright test` runner, or hand-roll a one-off browser launch for inspection. Skip this skill for authoring CI assertions with `@playwright/test`, unit/component tests, and non-UI work.
---

# Skill: playwright-ui-bridge

## Purpose

Agents need to look at and poke the running app — see how it renders, read live DOM, walk a stateful flow — without polluting the CI test suite. The failure mode this prevents: an agent drops ad-hoc inspection code into `tests/e2e/` (where `@playwright/test` CI assertions live), reaches for the `playwright test` runner, or hand-rolls an inconsistent browser launch, leaving orphaned processes and output no other agent can parse. This bridge keeps ephemeral UI investigation in its own lane, with a shared setup and a machine-readable result contract.

## Project context (the AGENTS.md contract)

This skill ships its own runtime (the `playwright` core library + the bundled `setupAgentBrowser` util). After any production code change driven by an inspection finding, verify with `pnpm deps:validate`, `pnpm typecheck`, and focused `pnpm exec vitest run <path>` — do not invent commands. The dev server URL comes from `BASE_URL` (default `http://localhost:5173`); confirm the server is up before running.

## Core rules

### 1. Location: agent scripts live in `.agents/ui-scripts/`

All agent-authored interaction scripts MUST be placed in `.agents/ui-scripts/`. Never place ad-hoc agent scripts in `tests/e2e/`, which is reserved for standard `@playwright/test` CI assertions.
_Why: mixing throwaway inspection code with the asserting CI suite makes the suite flaky and the inspection code un-findable; the two have opposite lifecycles (ephemeral vs. version-controlled gate)._

### 2. Execution: run scripts directly, not via the test runner

Do NOT use the Playwright test runner (`playwright test`). Instead, write standard Node scripts using the `playwright` core library and execute them directly via `npx tsx .agents/ui-scripts/<script-name>.ts`.
_Why: the test runner imposes assertion/reporter machinery and a config surface you don't want for a one-off probe; a plain `tsx` script gives you raw control over the page and a clean stdout for the JSON contract (rule 4)._

### 3. Standard setup: use `setupAgentBrowser`

You MUST use the provided `setupAgentBrowser` utility from `.agents/ui-scripts/utils.ts` to initialize the browser, context, and page. It launches headless Chromium and navigates to `process.env.BASE_URL || 'http://localhost:5173'`, returning `{ browser, page }`.
_Why: a shared launcher keeps every probe consistent (same browser, same base URL convention) and gives you one place to fix flakiness, instead of N divergent hand-rolled launches._

### 4. Structured output: JSON to stdout only

Your script MUST output data to `stdout` exclusively as a structured JSON string, so you (or another agent) can parse the interaction's result. Do not use `console.log` for arbitrary debugging output; use `console.error` for errors.
_Why: a single JSON object on stdout is machine-parseable; interleaved free-text debug lines corrupt the result so the next reader can't trust what the probe found._

### 5. Screenshots: capture and report the path

To perform visual analysis, capture a screenshot (e.g. `await page.screenshot({ path: '.agents/ui-scripts/my-screenshot.png' })`). You MUST include the saved `screenshotPath` in your JSON output so you know where to look.
_Why: a screenshot the agent can't locate is wasted work; emitting `screenshotPath` in the result is what turns the capture into something you can actually open and read._

### 6. Robust locators over fragile CSS

Prioritize robust locators (`page.getByRole`, `page.getByTestId`, `page.getByLabel`) over fragile CSS selectors.
_Why: role/testid/label locators survive markup and styling churn and assert intent (an accessible button, a labelled field); CSS-path selectors break on the next refactor and silently match the wrong node._

### 7. Cleanup: close the browser in `finally`

Your script MUST close the browser instance (`await browser.close()`) in a `finally` block to prevent orphaned processes.
_Why: an uncaught error mid-script otherwise leaves a headless Chromium running; over a session these accumulate and exhaust the machine's resources — the `finally` guarantees teardown on every path._

## What does not belong

- **CI assertions.** Anything that asserts behaviour for the version-controlled suite belongs in `tests/e2e/` with `@playwright/test`, not here. This bridge is for ephemeral inspection, not regression coverage.
- **Persisted scripts as deliverables.** Scripts under `.agents/ui-scripts/` are working probes, not artifacts to maintain; do not treat them as a test API.
- **Production code changes driven by what a probe showed.** Reading the live UI is diagnosis; fixing what you found is a separate task type with its own gate (and its own skill).
- **Arbitrary stdout debug logging.** Free-text status lines break the JSON contract (rule 4) — send them to `console.error` or omit them.

## Anti-patterns

- ❌ A new file in `tests/e2e/` that just clicks around and screenshots → ✅ put it in `.agents/ui-scripts/` and run it with `tsx`.
- ❌ `npx playwright test my-probe.spec.ts` → ✅ `npx tsx .agents/ui-scripts/my-probe.ts`.
- ❌ `const browser = await chromium.launch()` hand-rolled at the top of the script → ✅ `const { browser, page } = await setupAgentBrowser()`.
- ❌ `console.log('clicked play button')` scattered through the script → ✅ accumulate state into one object and `console.log(JSON.stringify(result, null, 2))` once.
- ❌ Screenshot saved but its path never surfaced → ✅ include `screenshotPath` in the emitted JSON.
- ❌ `page.locator('.btn-primary.transport > svg')` → ✅ `page.getByRole('button', { name: /Play/i })`.
- ❌ `await browser.close()` only on the happy path → ✅ `await browser.close()` inside a `finally` block.

## Example script

```typescript
import { setupAgentBrowser } from './utils';

async function main() {
    const { browser, page } = await setupAgentBrowser();

    try {
        await page.waitForLoadState('domcontentloaded');

        // Perform interaction
        await page.getByRole('button', { name: /Play/i }).click();

        // Capture state and visuals
        const isPlaying = await page.getByRole('button', { name: /Stop/i }).isVisible();
        const screenshotPath = '.agents/ui-scripts/transport-state.png';
        await page.screenshot({ path: screenshotPath });

        // Output structured data
        console.log(JSON.stringify({
            success: true,
            isPlaying,
            screenshotPath,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }, null, 2));
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
```

## Self-review gate

A probe or change made under this skill is not complete until each box below has a written answer and, where it produces output, that output is pasted verbatim.

- [ ] **Location.** Every script written this session lives under `.agents/ui-scripts/`, none under `tests/e2e/`. Paste `git status --short` (or `ls .agents/ui-scripts/`) showing where the files landed. Not complete until the path list appears verbatim.
- [ ] **Execution.** The script ran via `npx tsx .agents/ui-scripts/<name>.ts` (not `playwright test`). Paste the command's stdout — the single JSON object. Not complete until the JSON result appears verbatim.
- [ ] **Setup + cleanup.** Confirm in writing the script calls `setupAgentBrowser()` and closes the browser in a `finally` block.
- [ ] **Structured output.** Confirm the run emitted exactly one JSON object on stdout (rule 4) and that `success` and, if a screenshot was taken, `screenshotPath` are present in the pasted JSON.
- [ ] **Locators.** Confirm interaction used `getByRole`/`getByTestId`/`getByLabel`, not raw CSS-path selectors.
- [ ] **Repo gate (only if you touched committed code, e.g. `utils.ts`).** Paste verbatim output of `pnpm deps:validate`, `pnpm typecheck`, and focused `pnpm exec vitest run <path>`. Not complete until each command's last two lines appear verbatim.
