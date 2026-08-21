import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Comp knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).click();
        await panel.getByRole('button', { name: 'Comp', exact: true }).dispatchEvent('click');
    });

    test('ArrowUp steps Comp Thresh -20 to -19 and Ratio 4 to 4.5', async ({ page }) => {
        const thresh = page.getByRole('slider', { name: 'Thresh', exact: true });
        await expect(thresh).toHaveAttribute('aria-valuenow', '-20');
        await thresh.scrollIntoViewIfNeeded();
        await thresh.press('ArrowUp');
        await expect(thresh).toHaveAttribute('aria-valuenow', '-19');

        const ratio = page.getByRole('slider', { name: 'Ratio', exact: true });
        await expect(ratio).toHaveAttribute('aria-valuenow', '4');
        await ratio.scrollIntoViewIfNeeded();
        await ratio.press('ArrowUp');
        await expect(ratio).toHaveAttribute('aria-valuenow', '4.5');
    });
});
