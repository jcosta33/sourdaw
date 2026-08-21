import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Master knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');
        await panel.getByRole('button', { name: 'Master', exact: true }).dispatchEvent('click');
    });

    test('ArrowUp steps stereoWidth 1 to 1.01 and masterGain 1 to 1.01', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const width = panel.getByRole('slider', { name: 'stereoWidth', exact: true });
        await expect(width).toHaveAttribute('aria-valuenow', '1');
        await width.scrollIntoViewIfNeeded();
        await width.press('ArrowUp');
        await expect(width).toHaveAttribute('aria-valuenow', '1.01');

        const gain = panel.getByRole('slider', { name: 'masterGain', exact: true });
        await expect(gain).toHaveAttribute('aria-valuenow', '1');
        await gain.scrollIntoViewIfNeeded();
        await gain.press('ArrowUp');
        await expect(gain).toHaveAttribute('aria-valuenow', '1.01');
    });
});
