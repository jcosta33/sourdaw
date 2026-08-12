import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Proof's "Mission" rail lists factory presets as DawPluginChoiceRow buttons;
// the "Quick read" SideCard mirrors the active patch name in its "Preset"
// readout row. No prior E2E covered preset selection — this asserts that
// selecting a preset row swaps the patch name readout, the contract a user
// relies on to know the mastering desk reconfigured.
test.describe('Proof preset selection — changes patch name readout', () => {
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
        await inspector.getByText('Proof', { exact: false }).first().click();
        await expect(page.getByRole('slider', { name: 'Master limiter ceiling' })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('selecting a preset updates the Preset readout', async ({ page }) => {
        // The "Preset" readout label (singular) is unique vs the "Presets" rail
        // header (plural); its sole following-sibling span holds the active
        // patch name (default "Init").
        const presetReadout = page
            .getByText('Preset', { exact: true })
            .locator('xpath=following-sibling::span');

        const before = (await presetReadout.textContent()) ?? '';

        // The preset rows are DawPluginChoiceRow buttons titled with the preset
        // name; pick one that differs from the default "Init" patch.
        await page.getByRole('button', { name: 'Streaming Master' }).click();

        await expect(presetReadout).toHaveText('Streaming Master');
        expect(before.trim()).not.toBe('Streaming Master');
    });
});
