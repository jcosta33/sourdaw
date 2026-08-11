import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust A=B (unity gain) + Delta (delta listen) toggles: DawPluginChips, both
// default off. Clicking turns them on → aria-pressed="true". No E2E covers these.
test.describe('Crust A=B + Delta toggles — aria-pressed round-trip', () => {
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

    test('A=B toggle flips aria-pressed on then off', async ({ page }) => {
        const chip = page.getByRole('button', { name: 'A=B', exact: true });

        // Default: unityGain is off → no aria-pressed.
        await expect(chip).not.toHaveAttribute('aria-pressed', 'true');

        // Toggle on.
        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).toHaveAttribute('aria-pressed', 'true');

        // Toggle off.
        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).not.toHaveAttribute('aria-pressed', 'true');
    });

    test('Delta toggle flips aria-pressed on then off', async ({ page }) => {
        const chip = page.getByRole('button', { name: 'Delta', exact: true });

        await expect(chip).not.toHaveAttribute('aria-pressed', 'true');

        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).toHaveAttribute('aria-pressed', 'true');

        await chip.click();
        await page.waitForTimeout(300);
        await expect(chip).not.toHaveAttribute('aria-pressed', 'true');
    });
});
