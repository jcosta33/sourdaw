---
name: playwright-ui-bridge
description: >-
  Drive the live application UI through ad-hoc Playwright scripts to inspect DOM
  state, interact with a flow, or capture screenshots. ALWAYS apply when you need
  to verify how the app renders visually, inspect runtime DOM or layout too
  dynamic for static reading, or click through a stateful flow to debug it — even
  if the prompt only says "look at the UI" or "check the screen". Skip authoring
  maintained E2E assertions with `@playwright/test`, unit/component tests, and
  non-UI work.
---

## Purpose

Agents need to look at and poke the running app without polluting the maintained E2E suite. Dropping ad-hoc inspection into `tests/e2e/`, using the `playwright test` runner, or hand-rolling browser launches leaves orphaned processes and output no other agent can parse. This bridge keeps ephemeral UI investigation in its own lane with a shared setup and a machine-readable result contract.

## Core rules

### 1. Agent scripts live in `.agents/ui-scripts/`

Never place ad-hoc agent scripts in `tests/e2e/`, which is reserved for maintained `@playwright/test` assertions.

**Why:** throwaway probes and version-controlled gates have opposite lifecycles; mixing them makes the suite flaky and probes unfindable.

### 2. Run scripts directly, not via the test runner

Write standard Node scripts using the `playwright` core library and execute them with `node .agents/ui-scripts/<script-name>.ts`. Do not use the Playwright test runner for probes.

**Why:** the test runner adds assertion/reporter machinery you do not want for a one-off probe; a plain Node script keeps stdout clean for the JSON contract.

### 3. Use `setupAgentBrowser`

Initialize with `setupAgentBrowser` from `.agents/ui-scripts/utils.ts`. It launches headless Chromium, navigates to `process.env.BASE_URL || 'http://localhost:5173'`, and returns `{ browser, page }`.

**Why:** a shared launcher keeps every probe consistent and gives one place to fix flakiness.

### 4. Structured output: JSON to stdout only

Emit one structured JSON object on stdout. Use `console.error` for errors/debug — never free-text on stdout.

**Why:** interleaved debug lines corrupt the only machine-readable result.

### 5. Screenshots include `screenshotPath` in the JSON

```typescript
const screenshotPath = '.agents/ui-scripts/transport-state.png';
await page.screenshot({ path: screenshotPath });
console.log(JSON.stringify({ success: true, screenshotPath }, null, 2));
```

**Why:** a screenshot the next reader cannot locate is wasted work.

### 6. Robust locators over fragile CSS

Prefer `page.getByRole`, `page.getByTestId`, `page.getByLabel` over CSS-path selectors.

**Why:** role/testid/label locators survive markup churn and assert intent.

### 7. Close the browser in `finally`

```typescript
const { browser, page } = await setupAgentBrowser();
try {
    // …
    console.log(JSON.stringify({ success: true /* … */ }, null, 2));
} catch (error) {
    console.error(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
} finally {
    await browser.close();
}
```

**Why:** an uncaught error otherwise leaves headless Chromium running until resources die.

## What does not belong

- Production fixes driven only by a probe without a proper task gate.

## References

- `.agents/ui-scripts/utils.ts` — `setupAgentBrowser` shared launcher.
- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest/unit testing (not this bridge); maintained E2E stays under `tests/e2e/`.
