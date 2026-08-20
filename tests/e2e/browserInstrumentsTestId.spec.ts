import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function ensureBrowserOpen(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
    }
    // The browser panel must be open; if it is not, the harness contract is
    // broken and the test must fail rather than silently skip.
    await expect(search).toBeVisible({ timeout: 10_000 });
}

test.describe('Browser instrument cards — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await ensureBrowserOpen(page);
    });

    test('clicking an instrument card opens its device panel', async ({ page }) => {
        // The Instruments tab is the default; a Fermenter card is present.
        const fermenter = page.getByRole('button', { name: /^Fermenter/i }).first();
        await expect(fermenter).toBeVisible({ timeout: 10_000 });
        await fermenter.click();

        // The device panel mounts: its Close control appears. This is the
        // panel-open contract (no fixed delay), and a real state change.
        await expect(page.getByRole('button', { name: /Close Fermenter/i })).toBeVisible({ timeout: 15_000 });
    });

    test('browser search narrows the instrument list', async ({ page }) => {
        const search = page.getByTestId('browser-search');
        // Before filtering, multiple instrument cards are present.
        const allCards = page.getByRole('button', { name: /^(Fermenter|Levain|Toaster|Crumbs)/i });
        const beforeCount = await allCards.count();

        await search.fill('toaster');
        // Toaster is the match; Fermenter (a non-match) is filtered out.
        await expect(page.getByRole('button', { name: /^Toaster/i }).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: /^Fermenter/i })).toHaveCount(0);

        // Clearing the search restores the full list — a real round-trip.
        await search.fill('');
        await page.waitForTimeout(500);
        const afterCount = await allCards.count();
        expect(afterCount).toBe(beforeCount);
    });

    test('browser can switch between Instruments and Effects tabs', async ({ page }) => {
        const instrumentsTab = page.getByRole('button', { name: 'Instruments', exact: true }).first();
        const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
        await expect(instrumentsTab).toBeVisible();
        await expect(effectsTab).toBeVisible();

        // The Instruments tab renders Fermenter; the Effects tab does not.
        await expect(page.getByRole('button', { name: /^Fermenter/i }).first()).toBeVisible({ timeout: 5000 });
        await effectsTab.click();
        await expect(page.getByRole('button', { name: /^Fermenter/i })).toHaveCount(0);

        // Switching back restores the Instruments content.
        await instrumentsTab.click();
        await expect(page.getByRole('button', { name: /^Fermenter/i }).first()).toBeVisible({ timeout: 5000 });
    });
});
