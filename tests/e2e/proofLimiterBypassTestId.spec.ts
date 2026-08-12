import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof's limiter bypass lives in the Level 3 "Build" desk, inside
// ProofLimiterSection's DawPluginToggle (aria-label "Limiter module"). The
// toggle's `pressed` is `!patch.limBypassed` and its label reads "ON" while
// engaged and "OFF" while bypassed — the same DawPluginToggle contract Crust's
// bypass uses, but no E2E covered Proof's. There is no oversampling control in
// Proof (grep of src/modules/Proof returns nothing for oversampling/OS/quality),
// so this covers the next uncovered Proof toggle instead.
test.describe('Proof limiter bypass — toggle flips ON/OFF in Build desk', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();

        // Open the panel by clicking the device card text.
        await inspector.getByText('Proof', { exact: false }).first().click();
        // Wait for a Proof-specific panel control to mount before asserting.
        await expect(page.getByRole('button', { name: /reset loudness/i })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('clicking the limiter module toggle flips aria-pressed ON to OFF', async ({ page }) => {
        // The panel mounts at desk depth 1 (Play). Drop to depth 3 (Build) where
        // the per-module sections — including ProofLimiterSection — render.
        await page.getByRole('button', { name: 'Build Modules' }).click();

        const limiter = page.getByRole('button', { name: 'Limiter module' });
        await expect(limiter).toBeVisible({ timeout: 15_000 });

        // Default patch has limBypassed=false, so the toggle is pressed (ON).
        await expect(limiter).toHaveAttribute('aria-pressed', 'true');
        await expect(limiter).toContainText('ON');

        // Flip to bypassed — pressed goes false and the label swaps to OFF.
        await limiter.click();
        await page.waitForTimeout(300);

        await expect(limiter).toHaveAttribute('aria-pressed', 'false');
        await expect(limiter).toContainText('OFF');
    });
});
