import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster kit search', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('trap query keeps Trap Dough and hides Sourdough 808 until cleared', async ({ page }) => {
        const search = page.getByLabel('Search Toaster kits', { exact: true });
        const trap = page.getByRole('button', { name: 'Load kit Trap Dough', exact: true });
        const eightOhEight = page.getByRole('button', { name: 'Load kit Sourdough 808', exact: true });

        await expect(trap).toBeVisible();
        await expect(eightOhEight).toBeVisible();

        await search.fill('trap');
        await expect(trap).toBeVisible();
        await expect(eightOhEight).toHaveCount(0);

        await search.clear();
        await expect(trap).toBeVisible();
        await expect(eightOhEight).toBeVisible();
    });
});
