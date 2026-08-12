import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Toaster kit-level gain + pan sliders (always visible, separate from per-pad
// knobs). No E2E covers these — the per-pad matrix is complete (Tone, Crunch,
// Hit, Bright, Level, Pan) but the kit master gain/pan are uncovered.
test.describe('Toaster kit gain + pan — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('kit gain slider responds to keyboard', async ({ page }) => {
        const gain = page.getByRole('slider', { name: 'Toaster Kit gain' });
        await expect(gain).toBeVisible({ timeout: 10_000 });
        await gain.focus();
        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('kit pan slider responds to keyboard', async ({ page }) => {
        const pan = page.getByRole('slider', { name: 'Toaster Kit pan' });
        await expect(pan).toBeVisible({ timeout: 10_000 });
        await pan.focus();
        const before = Number(await pan.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await pan.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
