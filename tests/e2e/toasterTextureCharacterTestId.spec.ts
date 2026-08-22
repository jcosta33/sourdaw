import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Hit knob', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('ArrowUp moves Kick Hit one step from 50%', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Trigger Kick', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        const hit = page.getByRole('slider', { name: 'Hit', exact: true });
        await expect(hit).toHaveAttribute('aria-valuenow', '0.5');

        await hit.focus();
        await page.keyboard.press('ArrowUp');
        await expect(hit).toHaveAttribute('aria-valuenow', '0.51');
    });
});
