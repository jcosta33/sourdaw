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

test.describe('Levain family filter', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('Brass hides Solo Violin and Flutes, keeps Trumpets, and All restores Solo Violin', async ({ page }) => {
        const families = page.getByRole('radiogroup', { name: 'Filter instruments by family' });
        const lineup = families.locator('xpath=..');
        const all = families.getByRole('radio', { name: 'All', exact: true });
        const brass = families.getByRole('radio', { name: 'Brass', exact: true });
        const soloViolin = lineup.getByRole('button', { name: /Solo Violin/ });
        const trumpets = lineup.getByRole('button', { name: /Trumpets/ });
        const flutes = lineup.getByRole('button', { name: /Flutes/ });

        await expect(all).toHaveAttribute('aria-checked', 'true');
        await expect(soloViolin).toBeVisible();
        await expect(trumpets).toBeVisible();
        await expect(flutes).toBeVisible();

        await brass.click();

        await expect(brass).toHaveAttribute('aria-checked', 'true');
        await expect(all).not.toHaveAttribute('aria-checked', 'true');
        await expect(trumpets).toBeVisible();
        await expect(soloViolin).toHaveCount(0);
        await expect(flutes).toHaveCount(0);

        await all.click();

        await expect(all).toHaveAttribute('aria-checked', 'true');
        await expect(soloViolin).toBeVisible();
        await expect(trumpets).toBeVisible();
        await expect(flutes).toBeVisible();
    });
});
