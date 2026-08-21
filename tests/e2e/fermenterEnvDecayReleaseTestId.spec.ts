import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter envelope Decay and Release', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Envelopes', exact: true }).click();
    });

    test('ArrowUp steps amp Decay 0.2 to 0.206 and Release 0.3 to 0.306', async ({ page }) => {
        const decay = page.getByRole('slider', { name: 'ampDecay', exact: true });
        await expect(decay).toHaveAttribute('aria-valuenow', '0.2');
        await decay.scrollIntoViewIfNeeded();
        await decay.press('ArrowUp');
        await expect(decay).toHaveAttribute('aria-valuenow', '0.206');

        const release = page.getByRole('slider', { name: 'ampRelease', exact: true });
        await expect(release).toHaveAttribute('aria-valuenow', '0.3');
        await release.scrollIntoViewIfNeeded();
        await release.press('ArrowUp');
        await expect(release).toHaveAttribute('aria-valuenow', '0.306');
    });
});
