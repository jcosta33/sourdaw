import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// #1868 deleted a diverged TOOL_SHORTCUTS copy that had dropped
// `e: 'marquee'`; no spec presses `e`. The keyboard path is separate from
// the toolbar clicks the tools spec covers, so the shortcut gets its own
// regression pin: press `e` with focus outside any input (the contract is a
// window-level listener, no surface focus needed), the marquee radio becomes
// the checked one; press `1`, select returns.
test.describe('Marquee keyboard shortcut', () => {
    test("pressing 'e' activates the marquee tool, '1' restores select", async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        const select = page.getByTestId('tool-select');
        const marquee = page.getByTestId('tool-marquee');
        await expect(select).toBeVisible({ timeout: 10_000 });
        await expect(select).toHaveAttribute('aria-checked', 'true');
        await expect(marquee).toHaveAttribute('aria-checked', 'false');

        // The shortcut contract is a global keydown listener
        // (useGlobalKeyboardShortcuts) — no surface focus needed, only that
        // focus is not inside an input.
        await page.locator('body').focus();
        await page.keyboard.press('e');
        await expect(marquee).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        await expect(select).toHaveAttribute('aria-checked', 'false');

        await page.keyboard.press('1');
        await expect(select).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
        await expect(marquee).toHaveAttribute('aria-checked', 'false');
    });
});
