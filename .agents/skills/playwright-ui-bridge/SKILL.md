# SKILL: playwright-ui-bridge

## Purpose

This skill defines the rules and invariants for how agents interact with the live application UI using Playwright. Agents use this bridge not for writing CI tests, but for ad-hoc, ephemeral DOM inspection, interaction, and visual analysis (screenshotting).

Load this skill whenever you need to:
- Verify how the application is rendering visually (via screenshots).
- Dynamically inspect DOM state or layout that is too complex for static analysis.
- Interact with the application to debug a specific state (e.g., clicking through a modal flow).

---

## Core rules

1. **Location:** All agent-authored interaction scripts MUST be placed in `.agents/ui-scripts/`. Never place ad-hoc agent scripts in `tests/e2e/` (which is reserved for standard `@playwright/test` CI assertions).
2. **Execution:** Do NOT use the Playwright test runner (`playwright test`). Instead, write standard Node scripts using the `playwright` core library and execute them directly via `npx tsx .agents/ui-scripts/<script-name>.ts`.
3. **Standard Setup:** You MUST use the provided `setupAgentBrowser` utility from `.agents/ui-scripts/utils.ts` to initialize the browser, context, and page.
4. **Structured Output:** Your script MUST output data to `stdout` exclusively as a structured JSON string. This allows you (or other agents) to easily parse the results of the interaction. Do not use `console.log` for arbitrary debugging output; use `console.error` for errors.
5. **Screenshots:** To perform visual analysis, instruct your script to capture a screenshot (e.g., `await page.screenshot({ path: '.agents/ui-scripts/my-screenshot.png' })`). You MUST include the saved `screenshotPath` in your JSON output so you know where to look.
6. **Robust Locators:** Prioritize robust locators (`page.getByRole`, `page.getByTestId`, `page.getByLabel`) over fragile CSS selectors.
7. **Cleanup:** Your script MUST close the browser instance (`await browser.close()`) in a `finally` block to prevent orphaned processes.

---

## Example Script

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