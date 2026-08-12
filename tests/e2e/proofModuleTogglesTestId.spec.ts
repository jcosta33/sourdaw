import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof's Build desk (Level 3) renders five per-module sections, each with a
// DawPluginToggle bypass whose `pressed` is `!<module>Bypassed` and whose label
// reads "ON" while engaged and "OFF" while bypassed. #1783 covered the Limiter
// module toggle only. The other four — EQ, Dynamics, Imager, and Exciter — share
// the same DawPluginToggle contract but were uncovered by E2E. Defaults
// (ProofPatch): eqBypassed / dynBypassed / imgBypassed = false (toggle starts
// ON), excBypassed = true (toggle starts OFF). Each test asserts a full
// aria-pressed round-trip: ON -> OFF -> ON (or OFF -> ON -> OFF for Exciter).
test.describe('Proof Build module bypass toggles — aria-pressed round-trip', () => {
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

        // The panel mounts at desk depth 1 (Play). Drop to depth 3 (Build) where
        // the per-module sections render.
        await page.getByRole('button', { name: 'Build Modules' }).click();
    });

    test('EQ module bypass round-trips ON to OFF and back', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'EQ module' });
        await expect(toggle).toBeVisible({ timeout: 15_000 });

        // Default eqBypassed=false → pressed (ON).
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');

        // Flip to bypassed.
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toContainText('OFF');

        // Flip back to engaged.
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');
    });

    test('Dynamics module bypass round-trips ON to OFF and back', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Dynamics module' });
        await expect(toggle).toBeVisible({ timeout: 15_000 });

        // Default dynBypassed=false → pressed (ON).
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toContainText('OFF');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');
    });

    test('Imager module bypass round-trips ON to OFF and back', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Imager module' });
        await expect(toggle).toBeVisible({ timeout: 15_000 });

        // Default imgBypassed=false → pressed (ON).
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toContainText('OFF');

        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');
    });

    test('Exciter module bypass round-trips OFF to ON and back', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Exciter module' });
        await expect(toggle).toBeVisible({ timeout: 15_000 });

        // Default excBypassed=true → not pressed (OFF).
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toContainText('OFF');

        // Engage the module.
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle).toContainText('ON');

        // Bypass again.
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(toggle).toContainText('OFF');
    });
});
