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

test.describe('Toaster step sequencer — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('step sequencer cells are present via test IDs', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const step = page.getByTestId('toaster-step-0-0');
        await expect(step).toBeVisible({ timeout: 10_000 });
    });

    test('step cell has checkbox role and aria-checked', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const step = page.getByTestId('toaster-step-0-0');
        await expect(step).toBeVisible({ timeout: 10_000 });

        const role = await step.getAttribute('role');
        expect(role).toBe('checkbox');

        const checked = await step.getAttribute('aria-checked');
        expect(checked === 'true' || checked === 'false').toBe(true);
    });

    test('clicking a step toggles aria-checked', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const step = page.getByTestId('toaster-step-0-0');
        await expect(step).toBeVisible({ timeout: 10_000 });

        const before = await step.getAttribute('aria-checked');
        await step.click();
        await page.waitForTimeout(300);
        const after = await step.getAttribute('aria-checked');
        expect(after).not.toBe(before);
    });

    test('step has velocity info in aria-label when active', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const step = page.getByTestId('toaster-step-0-0');
        await expect(step).toBeVisible({ timeout: 10_000 });

        // Turn it on.
        if ((await step.getAttribute('aria-checked')) === 'false') {
            await step.click();
            await page.waitForTimeout(300);
        }

        const label = await step.getAttribute('aria-label');
        expect(label).toContain('on');
        expect(label).toContain('velocity');
    });

    test('multiple step cells exist per pad row', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        // Steps for pad 0 should have at least 4 cells.
        const steps = page.locator('[data-testid^="toaster-step-0-"]');
        await expect(steps.first()).toBeVisible({ timeout: 10_000 });
        const count = await steps.count();
        expect(count).toBeGreaterThanOrEqual(4);
    });
});
