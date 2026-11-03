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

## Rules

### 1. Agent scripts live in `.agents/ui-scripts/`

Never place an ad-hoc agent script in `tests/e2e/`, which is reserved for maintained `@playwright/test` assertions.

**Why:** throwaway probes and version-controlled gates have opposite lifecycles; mixing them makes the suite flaky and the probes unfindable.

**Enforced by:** review only.

### 2. Run scripts directly, not via the test runner

Write standard Node scripts against the `playwright` core library and execute them with `node .agents/ui-scripts/<script-name>.ts`.

**Why:** the test runner adds assertion and reporter machinery a one-off probe does not want, and it dirties the stdout the JSON contract owns.

**Enforced by:** review only.

### 3. Use `setupAgentBrowser`

Initialize with `setupAgentBrowser` from `.agents/ui-scripts/utils.ts`: it launches headless Chromium, navigates to `process.env.BASE_URL` or, absent that, the port `SOURDAW_E2E_PORT` selects (5173 by default, like e2e), and returns `{ browser, page }`. Before navigating it asserts the serving checkout's identity and refuses a dev server belonging to another checkout.

**Why:** one shared launcher is one place to fix flakiness.

**Enforced by:** `setupAgentBrowser` itself refuses a dev server belonging to another checkout; using it is review only.

### 4. Structured output: JSON to stdout only

Emit one structured JSON object on stdout. Send errors and debug to `console.error` — never free text on stdout.

**Why:** interleaved debug lines corrupt the only machine-readable result.

**Enforced by:** review only.

### 5. Screenshots report `screenshotPath`

Write screenshots under `.agents/ui-scripts/` and report the path in the JSON as `screenshotPath`.

**Why:** a screenshot the next reader cannot locate is wasted work.

**Enforced by:** review only.

### 6. Robust locators over fragile CSS

Use `page.getByRole`, `page.getByTestId`, and `page.getByLabel` over CSS-path selectors.

**Why:** they survive markup churn and assert intent.

**Enforced by:** review only.

### 7. Close the browser in `finally`

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

**Why:** an uncaught error otherwise leaves headless Chromium running until resources die.

**Enforced by:** review only.

### 8. Keep native select popups outside DOM-key claims

Native `<select>` popups are browser and OS UI. Observe each keyboard key from a focused, closed selector; after every key, use Escape and a real click on neutral non-control background to reset the popup, then prove `:open` is false, focus is restored, and global playhead and workspace state are unchanged before the next key. Native option selection may change the selected value normally; verify that value and its rendered lane separately, and do not manufacture that proof during popup cleanup. Do not generalize a local browser result to hosted platforms.

**Why:** the popup is outside the DOM, so a key observed while it is open proves browser behavior, not the app's.

**Enforced by:** review only.

### 9. Layout assertions distinguish request from allocation

An element's inline `style.height` is its requested CSS size; its bounding rectangle is the size layout actually allocated. When flex layout can shrink a panel, record and assert both values separately.

**Why:** a request can be honored in CSS while flex shrinks the allocated box, so asserting one value hides the other.

**Enforced by:** review only (probe: `review-stances/rendered-ui-layout.md`).

## References

- `.agents/ui-scripts/utils.ts` — `setupAgentBrowser` shared launcher.
- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest/unit testing (not this bridge); maintained E2E stays under `tests/e2e/`.
