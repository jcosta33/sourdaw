import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster kit Master gain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('ArrowUp steps kit Master from 1 to 1.01', async ({ page }) => {
        const master = page.getByRole('slider', { name: 'Master', exact: true });
        await expect(master).toHaveAttribute('aria-valuenow', '1');

        await master.scrollIntoViewIfNeeded();
        await master.press('ArrowUp');
        await expect(master).toHaveAttribute('aria-valuenow', '1.01');
    });
});
