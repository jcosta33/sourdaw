import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Toaster Groove template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Toaster' });
    });

    test('MPC 60 Feel assignment enables amount and ArrowDown steps it to 0.99', async ({ page }) => {
        const select = page.getByRole('combobox', { name: 'Pattern groove template' });
        await expect(select).toHaveValue('groove-straight');

        await select.selectOption({ label: 'MPC 60 Feel' });
        await expect(select).toHaveValue('mpc-60');

        const amount = page.getByRole('slider', { name: 'Pattern groove amount' });
        await expect(amount).toBeEnabled();
        await expect(amount).toHaveValue('1');

        await amount.scrollIntoViewIfNeeded();
        await amount.press('ArrowDown');
        await expect(amount).toHaveValue('0.99');
    });
});
