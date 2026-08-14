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

// Levain instrument search filter depth. The search input (aria-label="Search
// Levain instruments") is uncovered — no E2E asserts filtering narrows the
// instrument list.
test.describe('Levain instrument search — filter narrows list', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('typing a narrow query decreases the instrument count', async ({ page }) => {
        const search = page.getByLabel('Search Levain instruments');
        await expect(search).toBeVisible({ timeout: 10_000 });

        // Count instrument buttons before filtering.
        const instruments = page.locator('button.levain-window');
        await expect(instruments.first()).toBeVisible({ timeout: 5000 });
        const before = await instruments.count();
        expect(before).toBeGreaterThanOrEqual(2);

        // Type a narrow query.
        await search.fill('violin');
        await page.waitForTimeout(500);

        // The list narrowed (or is empty — either way the count changed).
        const after = await instruments.count();
        expect(after).toBeLessThan(before);

        // Clearing restores the full list.
        await search.fill('');
        await page.waitForTimeout(500);
        const restored = await instruments.count();
        expect(restored).toBe(before);
    });
});
