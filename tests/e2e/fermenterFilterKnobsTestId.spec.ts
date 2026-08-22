import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter Filter Cutoff and Env', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Filter', exact: true }).first().click();
    });

    test('ArrowUp steps Cutoff 5000 to 5010 and Env 0.5 to 0.51', async ({ page }) => {
        const cutoff = page.getByRole('slider', { name: 'filterCutoff', exact: true });
        await expect(cutoff).toHaveAttribute('aria-valuenow', '5000');
        await cutoff.scrollIntoViewIfNeeded();
        await cutoff.press('ArrowUp');
        await expect(cutoff).toHaveAttribute('aria-valuenow', '5010');

        const env = page.getByRole('slider', { name: 'Env', exact: true });
        await expect(env).toHaveAttribute('aria-valuenow', '0.5');
        await env.scrollIntoViewIfNeeded();
        await env.press('ArrowUp');
        await expect(env).toHaveAttribute('aria-valuenow', '0.51');
    });
});
