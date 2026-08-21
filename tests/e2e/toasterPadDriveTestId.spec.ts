import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Crunch knob', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('ArrowUp then ArrowDown steps Kick Crunch by 0.1', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Trigger Kick', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        const crunch = page.getByRole('slider', { name: 'Crunch', exact: true });
        await expect(crunch).toHaveAttribute('aria-valuenow', '0');

        await crunch.scrollIntoViewIfNeeded();
        await crunch.press('ArrowUp');
        await expect(crunch).toHaveAttribute('aria-valuenow', '0.1');

        await crunch.press('ArrowDown');
        await expect(crunch).toHaveAttribute('aria-valuenow', '0');
    });
});
