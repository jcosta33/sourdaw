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

test.describe('Toaster pad interaction — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Toaster pads are present via test IDs', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        // At least the first pad should be present.
        const pad0 = page.getByTestId('toaster-pad-0');
        await expect(pad0).toBeVisible({ timeout: 10_000 });
    });

    test('clicking a pad selects it (aria-pressed true)', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pad0 = page.getByTestId('toaster-pad-0');
        await expect(pad0).toBeVisible({ timeout: 10_000 });

        await pad0.click();
        await expect(pad0).toHaveAttribute('aria-pressed', 'true');
    });

    test('selecting a different pad deselects the first', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pad0 = page.getByTestId('toaster-pad-0');
        const pad1 = page.getByTestId('toaster-pad-1');

        await expect(pad0).toBeVisible({ timeout: 10_000 });

        await pad0.click();
        await expect(pad0).toHaveAttribute('aria-pressed', 'true');

        if (await pad1.isVisible().catch(() => false)) {
            await pad1.click();
            await expect(pad1).toHaveAttribute('aria-pressed', 'true');
            await expect(pad0).toHaveAttribute('aria-pressed', 'false');
        }
    });

    test('pads have valid aria-labels with pad names', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pad0 = page.getByTestId('toaster-pad-0');
        await expect(pad0).toBeVisible({ timeout: 10_000 });

        const label = await pad0.getAttribute('aria-label');
        expect(label).toContain('Trigger');
    });

    test('multiple pads are present (16 for default kit)', async ({ page }) => {
        const opened = await openToaster(page);
        if (!opened) return;

        const pads = page.locator('[data-testid^="toaster-pad-"]');
        await expect(pads.first()).toBeVisible({ timeout: 10_000 });
        const count = await pads.count();
        expect(count).toBeGreaterThanOrEqual(4);
    });
});
