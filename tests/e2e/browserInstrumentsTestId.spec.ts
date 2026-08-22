import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Browser Instruments tab', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('toaster search hides Fermenter then clears; Effects hides Fermenter and Instruments restores it', async ({
        page,
    }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const search = browser.getByRole('searchbox', { name: 'Search browser' });
        const fermenter = browser.getByRole('button', { name: /^Fermenter/ });
        const toaster = browser.getByRole('button', { name: /^Toaster/ });

        await expect(fermenter).toBeVisible();
        await expect(toaster).toBeVisible();

        await search.fill('toaster');
        await expect(toaster).toBeVisible();
        await expect(fermenter).toHaveCount(0);

        await search.fill('');
        await expect(fermenter).toBeVisible();
        await expect(toaster).toBeVisible();

        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await expect(fermenter).toHaveCount(0);

        await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
        await expect(fermenter).toBeVisible();
    });
});
