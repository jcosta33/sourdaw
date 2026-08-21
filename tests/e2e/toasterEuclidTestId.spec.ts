import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Euclid fill', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Toast applies 3 of 8 hits on Kick steps 1, 4, and 6', async ({ page }) => {
        const fill = page.getByText('Fill tools', { exact: true }).locator('xpath=../..');
        const hits = fill.getByRole('spinbutton').nth(0);
        const steps = fill.getByRole('spinbutton').nth(1);
        await expect(hits).toHaveValue('4');
        await expect(steps).toHaveValue('16');

        await hits.fill('3');
        await steps.fill('8');
        await fill.getByRole('button', { name: 'Toast', exact: true }).click();

        await expect(page.getByRole('checkbox', { name: 'Kick step 1, on, velocity 80%', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: 'Kick step 4, on, velocity 80%', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: 'Kick step 6, on, velocity 80%', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: 'Kick step 5, off', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: /^Kick step \d+, off$/ })).toHaveCount(13);
    });
});
