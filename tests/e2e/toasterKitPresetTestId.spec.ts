import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster kit shelf and sequencer', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('loading Sourdough 808 selects that kit and remaps Closed HH to CH', async ({ page }) => {
        const closedHh = page.getByRole('button', { name: 'Trigger Closed HH', exact: true });
        const ch = page.getByRole('button', { name: 'Trigger CH', exact: true });
        const load808 = page.getByRole('button', { name: 'Load kit Sourdough 808', exact: true });

        await expect(closedHh).toBeVisible();
        await expect(ch).toHaveCount(0);
        await expect(load808).toHaveAttribute('aria-pressed', 'false');

        await load808.click();

        await expect(load808).toHaveAttribute('aria-pressed', 'true');
        await expect(ch).toBeVisible();
        await expect(closedHh).toHaveCount(0);
    });

    test('Kick step 1 toggles on and Close dismisses Toaster', async ({ page }) => {
        const off = page.getByRole('checkbox', { name: 'Kick step 1, off', exact: true });
        await expect(off).toHaveAttribute('aria-checked', 'false');

        await off.click();
        await expect(page.getByRole('checkbox', { name: /Kick step 1, on/ })).toHaveAttribute('aria-checked', 'true');

        const close = page.getByRole('button', { name: 'Close Toaster', exact: true });
        await close.click();
        await expect(close).toHaveCount(0);
    });
});
