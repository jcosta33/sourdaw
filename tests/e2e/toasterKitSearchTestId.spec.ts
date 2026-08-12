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

// Toaster kit search: the "Kit shelf" search input (aria-label="Search Toaster
// kits") filtered the preset list purely in component state with no observable
// contract, so the search flow was never covered. The picker buttons carry
// aria-label="Load kit <name>", so their count is a real DOM readout of the
// filter. This spec asserts the state change: a narrow query shrinks the list,
// and clearing the query restores it.
test.describe('Toaster kit search — filtering narrows and restores the kit list', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('typing a query narrows the kit shelf and clearing restores it', async ({ page }) => {
        const kitButtons = page.getByRole('button', { name: /^Load kit /i });
        await expect(kitButtons.first()).toBeVisible({ timeout: 10_000 });

        const totalCount = await kitButtons.count();
        expect(totalCount).toBeGreaterThanOrEqual(2);

        // A narrow query ("808") matches only a subset of kits (e.g. the
        // "Sourdough 808" kit and kits whose description/tags mention 808), so
        // the button count must drop below the unfiltered total.
        const search = page.getByLabel('Search Toaster kits');
        await search.fill('808');
        await expect
            .poll(async () => kitButtons.count(), { timeout: 10_000 })
            .toBeLessThan(totalCount);

        const filteredCount = await kitButtons.count();
        expect(filteredCount).toBeGreaterThanOrEqual(1);

        // Clearing the query removes the filter — the full list returns.
        await search.clear();
        await expect
            .poll(async () => kitButtons.count(), { timeout: 10_000 })
            .toBe(totalCount);
    });
});
