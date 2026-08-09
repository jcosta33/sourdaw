import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('levain');
    await page.waitForTimeout(500);
    // The Levain card must be reachable; if it is not, the panel-open contract
    // is broken and the test must fail rather than silently skip.
    const card = page.getByRole('button', { name: /^Levain/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: wait on the Close control instead of a fixed delay.
    await expect(page.getByRole('button', { name: /Close Levain/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Levain articulation & instrument panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Levain close button hides the panel', async ({ page }) => {
        await openLevain(page);
        const close = page.getByRole('button', { name: /Close Levain/i }).first();
        await close.click();
        // Closing unmounts the panel — the Close control is gone.
        await expect(close).toHaveCount(0);
    });

    test('Levain knob responds to keyboard — aria-valuenow changes on ArrowUp', async ({ page }) => {
        await openLevain(page);
        const firstSlider = page.getByRole('slider').first();
        await expect(firstSlider).toBeVisible({ timeout: 5000 });
        await firstSlider.focus();
        const before = Number(await firstSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await firstSlider.getAttribute('aria-valuenow'));
        if (before < 1) {
            expect(after).toBeGreaterThan(before);
        }
    });
});
