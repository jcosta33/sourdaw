import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Levain/ }).click();
    await expect(page.getByRole('button', { name: 'Close Levain' })).toBeVisible({
        timeout: 30_000,
    });
}

test.describe('Levain instrument search', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('violin keeps Solo Violin, hides Trumpets, and clear restores Trumpets', async ({ page }) => {
        const search = page.getByRole('textbox', { name: 'Search Levain instruments' });
        const lineup = search.locator('xpath=../..');
        const soloViolin = lineup.getByRole('button', { name: /Solo Violin/ });
        const trumpets = lineup.getByRole('button', { name: /Trumpets/ });

        await expect(soloViolin).toBeVisible();
        await expect(trumpets).toBeVisible();

        await search.fill('violin');

        await expect(soloViolin).toBeVisible();
        await expect(trumpets).toHaveCount(0);

        await search.fill('');

        await expect(soloViolin).toBeVisible();
        await expect(trumpets).toBeVisible();
    });
});
