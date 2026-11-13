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

### 1. Probe scripts live under `~/.agents/artifacts/`, never in the repository

Write probe scripts and their screenshots under `~/.agents/artifacts/` (for example `~/.agents/artifacts/ui-scripts/`). Never place them in the repository — not in `.agents/ui-scripts/`, whose only tracked file is the shared `utils.ts` and which ignores only its `*.png`, and never in `tests/e2e/`, which is reserved for maintained `@playwright/test` assertions. Delete scripts and screenshots once you no longer need them.

**Why:** throwaway probes and version-controlled gates have opposite lifecycles; a script written inside a checkout sits untracked in a tree other lanes share, and mixing probes into the suite makes it flaky and the probes unfindable. One-offs belong in `~/.agents/artifacts` (root `AGENTS.md`, Artifacts).

**Enforced by:** review only.

### 2. Serve the lane in e2e mode, then run the script with Node

Export a lane-unique `SOURDAW_E2E_PORT` (derive it from the lane slug, root `AGENTS.md` Worktrees), then from the lane start the server in the background with `node scripts/e2eDevServer.ts "$SOURDAW_E2E_PORT"` — the command `playwright.config.ts` uses as its web server. It serves in e2e mode, whose responses carry the serving checkout's identity marker (`sourdawE2eServingCheckoutPlugin` in `vite.config.ts`). Never probe against plain `pnpm dev`: it carries no marker, so the identity assertion cannot refuse another checkout's server. Write a standard Node script against the `playwright` core library and run it with `node ~/.agents/artifacts/ui-scripts/<script-name>.ts`, never through the test runner. Stop the server when you are done.

**Why:** the test runner adds assertion and reporter machinery a one-off probe does not want, and it dirties the stdout the JSON contract owns; a server without the marker lets a probe silently inspect another lane's build.

**Enforced by:** review only.

### 3. Use `setupAgentBrowser` from the lane's `utils.ts`

Import `setupAgentBrowser` from the lane's `.agents/ui-scripts/utils.ts` by absolute path, with the explicit `.ts` extension: Node type stripping does not resolve extensionless TypeScript imports. `utils.ts` resolves `playwright` and its checkout identity from its own location, so the identity check binds to the lane whose `utils.ts` you import. It launches headless Chromium by default; use `setupAgentBrowser({ headless: false })` for real hardware probes. It navigates to `process.env.BASE_URL` or, absent that, the port `SOURDAW_E2E_PORT` selects (5173 by default, like e2e), and returns `{ browser, page }`. Before navigating it asserts the serving checkout's identity and refuses a dev server belonging to another checkout.

For cache-sized probes, `temporaryPersistentProfile: true` opts into a fresh, empty disk-backed profile created by the helper under resourceGuard-owned `TMPDIR`. It accepts no caller profile path or launch flags. The default remains a non-persistent context. Retain the returned profile metadata and close the real returned browser in `finally`; setup failure closes the persistent context. The guard owns profile reclamation after browser handles close. Reported storage quota is an observation, not usable-capacity admission.

**Why:** one shared launcher is one place to fix flakiness, and importing it from the lane under test is what points its identity check at that lane.

**Enforced by:** `setupAgentBrowser` itself refuses a dev server whose marker names another checkout; importing it from the right lane is review only.

### 4. Structured output: JSON to stdout only

Emit one structured JSON object on stdout. Send errors and debug to `console.error` — never free text on stdout.

**Why:** interleaved debug lines corrupt the only machine-readable result.

**Enforced by:** review only.

### 5. Screenshots report `screenshotPath`

Write screenshots under `~/.agents/artifacts/` beside the script (rule 1) and report the absolute path in the JSON as `screenshotPath`.

**Why:** a screenshot the next reader cannot locate is wasted work.

**Enforced by:** review only.

### 6. Robust locators over fragile CSS

Use `page.getByRole`, `page.getByTestId`, and `page.getByLabel` over CSS-path selectors.

**Why:** they survive markup churn and assert intent.

**Enforced by:** review only.

### 7. Close the browser in `finally`

```typescript
import type { Page } from 'playwright';

import { setupAgentBrowser } from '/absolute/path/to/lane/.agents/ui-scripts/utils.ts';

async function inspect(page: Page) {
    return { title: await page.title() };
}

const { browser, page } = await setupAgentBrowser();
try {
    const result = await inspect(page);
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
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

- `.agents/ui-scripts/utils.ts` — `setupAgentBrowser` shared launcher; import it from the lane under test by absolute path.
- `scripts/e2eDevServer.ts` and `playwright.config.ts` — the e2e-mode server command and lane-scoped port.
- [AGENTS.md](../../../AGENTS.md) — Artifacts (where one-offs live) and Worktrees (lane-unique `SOURDAW_E2E_PORT`).
- [docs/06-testing.md](../../../docs/06-testing.md) — Vitest/unit testing (not this bridge); maintained E2E stays under `tests/e2e/`.
