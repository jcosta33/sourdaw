import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust oversampling factor chips: DawPluginChips that switch the oversampling
// factor (OS off / 2× / 4× / ...). aria-pressed flips on selection. No E2E
// covers this.
test.describe('Crust oversampling — selecting a factor flips aria-pressed', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('selecting OS off flips its chip and clears the 4× default', async ({ page }) => {
        // Default oversampling is 4 (DEFAULT_CRUST_PATCH.oversampling = 4).
        const os4x = page.getByRole('button', { name: '4×', exact: true });
        const osOff = page.getByRole('button', { name: 'OS off', exact: true });

        await expect(os4x).toHaveAttribute('aria-pressed', 'true');

        await osOff.click();
        await page.waitForTimeout(300);

        await expect(osOff).toHaveAttribute('aria-pressed', 'true');
        await expect(os4x).not.toHaveAttribute('aria-pressed', 'true');
    });
});
