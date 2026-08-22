import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter oscillator Noise', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('ArrowUp steps Noise 0 to 0.01', async ({ page }) => {
        const noise = page.locator('.fermenter-faceplate').getByRole('slider', { name: 'Noise', exact: true });
        await expect(noise).toHaveAttribute('aria-valuenow', '0');
        await noise.scrollIntoViewIfNeeded();
        await noise.press('ArrowUp');
        await expect(noise).toHaveAttribute('aria-valuenow', '0.01');
    });
});
