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

Look at and poke the running app without polluting the maintained E2E suite. Ephemeral UI investigation gets its own lane, a shared setup, and a machine-readable result contract. A probe is evidence, never a gate: a production fix still needs its proper task gate.

## Core rules

### 1. Agent scripts live in `.agents/ui-scripts/`

Never place an ad-hoc agent script in `tests/e2e/`, which is reserved for maintained `@playwright/test` assertions. Throwaway probes and version-controlled gates have opposite lifecycles; mixing them makes the suite flaky and the probes unfindable.

### 2. Run scripts directly, not via the test runner

Write standard Node scripts against the `playwright` core library and execute them with `node .agents/ui-scripts/<script-name>.ts`. The test runner adds assertion and reporter machinery a one-off probe does not want, and it dirties the stdout the JSON contract owns.

### 3. Use `setupAgentBrowser`

Initialize with `setupAgentBrowser` from `.agents/ui-scripts/utils.ts`: it launches headless Chromium, navigates to `process.env.BASE_URL || 'http://localhost:5173'`, and returns `{ browser, page }`. One shared launcher is one place to fix flakiness.

### 4. Structured output: JSON to stdout only

Emit one structured JSON object on stdout. Send errors and debug to `console.error` — never free text on stdout, because interleaved debug lines corrupt the only machine-readable result.

### 5. Screenshots report `screenshotPath`

Write screenshots under `.agents/ui-scripts/` and report the path in the JSON as `screenshotPath`. A screenshot the next reader cannot locate is wasted work.

### 6. Robust locators over fragile CSS

Use `page.getByRole`, `page.getByTestId`, and `page.getByLabel` over CSS-path selectors: they survive markup churn and assert intent.

### 7. Close the browser in `finally`

An uncaught error otherwise leaves headless Chromium running until resources die.

```typescript
const { browser, page } = await setupAgentBrowser();
try {
    // …
    console.log(JSON.stringify({ success: true /* … */ }, null, 2));
} catch (error) {
    console.error(
        JSON.stringify(
            {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
        )
    );
    process.exitCode = 1;
} finally {
    await browser.close();
}
```

## References

- `.agents/ui-scripts/utils.ts` — `setupAgentBrowser` shared launcher.
- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest/unit testing (not this bridge); maintained E2E stays under `tests/e2e/`.
