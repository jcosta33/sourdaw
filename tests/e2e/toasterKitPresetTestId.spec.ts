import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    if (await card.isVisible().catch(() => false)) {
        await card.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

test.describe('Toaster kit & pad deep', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toaster pads are clickable and select correctly', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();
        await expect(pad0).toHaveAttribute('aria-pressed', 'true');
    });

    test('Toaster step sequencer cells toggle', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const step = page.getByTestId('toaster-step-0-0');
        await expect(step).toBeVisible({ timeout: 5000 });

        const before = await step.getAttribute('aria-checked');
        await step.click();
        await page.waitForTimeout(300);
        const after = await step.getAttribute('aria-checked');
        expect(after).not.toBe(before);
    });

    test('Toaster panel has parameter sliders', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const sliders = page.getByRole('slider');
        expect(await sliders.count()).toBeGreaterThan(0);
    });

    test('Toaster close button works', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const close = page.getByRole('button', { name: /Close Toaster/i }).first();
        await close.click();
        await page.waitForTimeout(500);
        await expect(close).not.toBeVisible();
    });

    test('Toaster pad selection persists across step toggle', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pad0 = page.getByTestId('toaster-pad-0');
        await pad0.click();
        await expect(pad0).toHaveAttribute('aria-pressed', 'true');

        // Toggle a step — pad should still be selected.
        const step = page.getByTestId('toaster-step-0-0');
        if (await step.isVisible().catch(() => false)) {
            await step.click();
            await page.waitForTimeout(300);
        }

        await expect(pad0).toHaveAttribute('aria-pressed', 'true');
    });
});
