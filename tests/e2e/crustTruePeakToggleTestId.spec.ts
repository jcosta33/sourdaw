import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust true-peak toggle: a DawPluginChip that flips truePeak on/off. Default
// is on (truePeak=1); clicking toggles it. aria-pressed reflects the state.
test.describe('Crust true-peak toggle — aria-pressed round-trip', () => {
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

    test('clicking True peak toggles aria-pressed off then on', async ({ page }) => {
        const chip = page.getByRole('button', { name: 'True peak', exact: true });

        // Default: truePeak is on (1) → aria-pressed is present/true.
        await expect(chip).toHaveAttribute('aria-pressed', 'true');

        // Toggle off.
        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).not.toHaveAttribute('aria-pressed', 'true');

        // Toggle back on.
        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
    });
});
