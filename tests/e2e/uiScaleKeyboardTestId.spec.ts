import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Preferences Appearance → UI Scale slider. Existing spec asserts the slider
// EXISTS with a numeric aria-valuenow — existence-only. This asserts ArrowUp
// changes the value.
test.describe('Preferences UI Scale slider — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+,`);
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await dialog.waitFor({ state: 'visible', timeout: 5000 });
        await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
        await page.waitForTimeout(300);
    });

    test.afterEach(async ({ page }) => {
        await page.keyboard.press('Escape');
    });

    test('UI Scale slider responds to ArrowUp', async ({ page }) => {
        const slider = page.getByRole('slider', { name: 'UI Scale' });
        await expect(slider).toBeVisible({ timeout: 5000 });
        await slider.focus();
        const before = Number(await slider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await slider.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
