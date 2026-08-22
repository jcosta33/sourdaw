import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter LFO Rate', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Envelopes', exact: true }).click();
    });

    test('ArrowUp steps LFO Rate 0 to 0.1', async ({ page }) => {
        const rate = page.locator('.fermenter-faceplate').getByRole('slider', { name: 'lfoRate', exact: true });
        await expect(rate).toHaveAttribute('aria-valuenow', '0');
        await rate.scrollIntoViewIfNeeded();
        await rate.press('ArrowUp');
        await expect(rate).toHaveAttribute('aria-valuenow', '0.1');
    });
});
