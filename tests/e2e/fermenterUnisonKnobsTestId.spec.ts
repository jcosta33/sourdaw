import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter Unison knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('ArrowUp steps Unison Voices 1 to 2 and Detune 15 to 16', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');

        const voices = panel.getByRole('slider', { name: 'Voices', exact: true });
        await expect(voices).toHaveAttribute('aria-valuenow', '1');
        await voices.scrollIntoViewIfNeeded();
        await voices.press('ArrowUp');
        await expect(voices).toHaveAttribute('aria-valuenow', '2');

        const detune = panel.getByRole('slider', { name: 'Detune', exact: true });
        await expect(detune).toHaveAttribute('aria-valuenow', '15');
        await detune.scrollIntoViewIfNeeded();
        await detune.press('ArrowUp');
        await expect(detune).toHaveAttribute('aria-valuenow', '16');
    });
});
