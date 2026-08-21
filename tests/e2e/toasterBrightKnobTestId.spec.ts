import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Kick Bright', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('ArrowDown steps Kick Bright from 20000 to 19990', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Trigger Kick', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        const bright = page.getByRole('slider', { name: 'Bright', exact: true });
        await expect(bright).toHaveAttribute('aria-valuenow', '20000');

        await bright.scrollIntoViewIfNeeded();
        await bright.press('ArrowDown');
        await expect(bright).toHaveAttribute('aria-valuenow', '19990');
    });
});
