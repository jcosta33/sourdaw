import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter FX Reverb knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
        const panel = page.locator('.fermenter-faceplate');
        await panel.getByRole('button', { name: 'Effects', exact: true }).dispatchEvent('click');
        await panel.getByRole('button', { name: 'Reverb', exact: true }).dispatchEvent('click');
    });

    test('ArrowUp steps Reverb Mix 0.2 to 0.21 and Decay 0.5 to 0.51', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const mix = panel.getByRole('slider', { name: 'Mix', exact: true });
        await expect(mix).toHaveAttribute('aria-valuenow', '0.2');
        await mix.scrollIntoViewIfNeeded();
        await mix.press('ArrowUp');
        await expect(mix).toHaveAttribute('aria-valuenow', '0.21');

        const decay = panel.getByRole('slider', { name: 'Decay', exact: true });
        await expect(decay).toHaveAttribute('aria-valuenow', '0.5');
        await decay.scrollIntoViewIfNeeded();
        await decay.press('ArrowUp');
        await expect(decay).toHaveAttribute('aria-valuenow', '0.51');
    });
});
