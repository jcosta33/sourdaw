import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster kit selection', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('Trap Dough remaps Kick to Deep 808 and Blank Flour restores exclusive select', async ({ page }) => {
        const closedHh = page.getByRole('button', { name: 'Trigger Closed HH', exact: true });
        const deep808 = page.getByRole('button', { name: 'Trigger Deep 808', exact: true });
        const trap = page.getByRole('button', { name: 'Load kit Trap Dough', exact: true });
        const blank = page.getByRole('button', { name: 'Load kit Blank Flour', exact: true });

        await expect(closedHh).toBeVisible();
        await expect(deep808).toHaveCount(0);
        await expect(trap).toHaveAttribute('aria-pressed', 'false');

        await trap.click();
        await expect(trap).toHaveAttribute('aria-pressed', 'true');
        await expect(deep808).toBeVisible();
        await expect(closedHh).toHaveCount(0);

        await blank.click();
        await expect(blank).toHaveAttribute('aria-pressed', 'true');
        await expect(trap).toHaveAttribute('aria-pressed', 'false');
        await expect(closedHh).toBeVisible();
        await expect(deep808).toHaveCount(0);
    });
});
