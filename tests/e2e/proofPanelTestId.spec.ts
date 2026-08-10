import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Proof is a mastering effect added via the inspector Add-device menu on a
// track. The previous version of this spec opened the panel via browser search
// (Proof is not in the browser) and silently skipped every assertion behind
// `if (await …isVisible())` guards, so a regression that broke the add flow
// turned the tests into no-ops. This version asserts the real add state change
// directly: the Bypass-button count rises by one and a `Bypass Proof` toggle
// appears — the same contract the rewritten Crust/Dutch Oven tests assert.
test.describe('Proof device — add to chain', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Adding Proof creates a bypassable device card in the chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();

        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await page.waitForTimeout(800);

        // A Proof device card is added — count rises by one and the bypass
        // toggle is present, where the panel-open guards used to hide a failure.
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);
    });
});
