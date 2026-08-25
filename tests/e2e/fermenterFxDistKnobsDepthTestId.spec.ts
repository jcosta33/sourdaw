import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Dist knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page
            .locator('.fermenter-faceplate')
            .getByRole('button', { name: 'Effects', exact: true })
            .dispatchEvent('click');
    });

    test('ArrowUp steps Dist Drive 0 to 0.1 and Mix 0 to 0.01', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const drive = panel.getByRole('slider', { name: 'Drive', exact: true });
        await expect(drive).toHaveAttribute('aria-valuenow', '0');
        await drive.scrollIntoViewIfNeeded();
        await drive.press('ArrowUp');
        await expect(drive).toHaveAttribute('aria-valuenow', '0.1');

        const mix = panel.getByRole('slider', { name: 'Mix', exact: true });
        await expect(mix).toHaveAttribute('aria-valuenow', '0');
        await mix.scrollIntoViewIfNeeded();
        await mix.press('ArrowUp');
        await expect(mix).toHaveAttribute('aria-valuenow', '0.01');
    });
});
