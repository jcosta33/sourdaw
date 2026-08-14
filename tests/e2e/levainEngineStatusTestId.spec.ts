import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('levain');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Levain/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByRole('button', { name: /Close Levain/i }).first()).toBeVisible({ timeout: 15_000 });
}

// Levain engine status LED. The panel shows 'Engine loading' while the WASM
// engine boots, then flips to 'Engine ready'. No E2E covers this transition.
test.describe('Levain engine status — LED reaches ready', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('the engine status LED reaches the ready state', async ({ page }) => {
        const led = page.locator('[role="status"][aria-label^="Engine"]');
        await expect(led).toBeVisible({ timeout: 10_000 });

        // Poll for the ready state — the engine finishes booting after the
        // panel opens (WASM init + sample registration).
        await expect
            .poll(async () => led.getAttribute('aria-label'), { timeout: 30_000 })
            .toBe('Engine ready');

        // The visible text also reflects ready.
        await expect(led).toContainText('Ready');
    });
});
