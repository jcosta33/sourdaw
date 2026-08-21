import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter Filter Reso Drive and Key', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        await page.locator('.fermenter-faceplate').getByRole('button', { name: 'Filter', exact: true }).first().click();
    });

    test('ArrowUp steps Reso 1 to 1.1, Drive 0 to 0.1, and Key 0 to 0.01', async ({ page }) => {
        const reso = page.getByRole('slider', { name: 'filterResonance', exact: true });
        await expect(reso).toHaveAttribute('aria-valuenow', '1');
        await reso.scrollIntoViewIfNeeded();
        await reso.press('ArrowUp');
        await expect(reso).toHaveAttribute('aria-valuenow', '1.1');

        const drive = page.getByRole('slider', { name: 'Drive', exact: true });
        await expect(drive).toHaveAttribute('aria-valuenow', '0');
        await drive.scrollIntoViewIfNeeded();
        await drive.press('ArrowUp');
        await expect(drive).toHaveAttribute('aria-valuenow', '0.1');

        const key = page.getByRole('slider', { name: 'Key', exact: true });
        await expect(key).toHaveAttribute('aria-valuenow', '0');
        await key.scrollIntoViewIfNeeded();
        await key.press('ArrowUp');
        await expect(key).toHaveAttribute('aria-valuenow', '0.01');
    });
});
