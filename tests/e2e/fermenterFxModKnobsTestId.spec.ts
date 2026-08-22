import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Mod knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');
        await panel.getByRole('button', { name: 'Chorus/Phaser', exact: true }).dispatchEvent('click');
    });

    test('ArrowUp steps Chorus Rate 1.2 to 1.3 and Mix 0 to 0.01', async ({ page }) => {
        const chorus = page.locator('.fermenter-faceplate').getByText('Chorus', { exact: true }).locator('xpath=..');

        const rate = chorus.getByRole('slider', { name: 'Rate', exact: true });
        await expect(rate).toHaveAttribute('aria-valuenow', '1.2');
        await rate.scrollIntoViewIfNeeded();
        await rate.press('ArrowUp');
        await expect(rate).toHaveAttribute('aria-valuenow', '1.3');

        const mix = chorus.getByRole('slider', { name: 'Mix', exact: true });
        await expect(mix).toHaveAttribute('aria-valuenow', '0');
        await mix.scrollIntoViewIfNeeded();
        await mix.press('ArrowUp');
        await expect(mix).toHaveAttribute('aria-valuenow', '0.01');
    });
});
