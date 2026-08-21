import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster step sequencer', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('default pattern exposes sixteen off Kick steps', async ({ page }) => {
        await expect(page.getByRole('checkbox', { name: /^Kick step \d+, off$/ })).toHaveCount(16);
    });

    test('Kick step 1 reports velocity 80% when on and turns off again', async ({ page }) => {
        const off = page.getByRole('checkbox', { name: 'Kick step 1, off', exact: true });
        await off.click();

        const on = page.getByRole('checkbox', { name: 'Kick step 1, on, velocity 80%', exact: true });
        await expect(on).toHaveAttribute('aria-checked', 'true');

        await on.click();
        await expect(page.getByRole('checkbox', { name: 'Kick step 1, off', exact: true })).toHaveAttribute(
            'aria-checked',
            'false'
        );
    });

    test('Snare step 5 toggles without turning Kick step 1 on', async ({ page }) => {
        const kickOff = page.getByRole('checkbox', { name: 'Kick step 1, off', exact: true });
        const snareOff = page.getByRole('checkbox', { name: 'Snare step 5, off', exact: true });

        await expect(kickOff).toHaveAttribute('aria-checked', 'false');
        await snareOff.click();

        await expect(
            page.getByRole('checkbox', { name: 'Snare step 5, on, velocity 80%', exact: true })
        ).toHaveAttribute('aria-checked', 'true');
        await expect(kickOff).toHaveAttribute('aria-checked', 'false');
    });
});
