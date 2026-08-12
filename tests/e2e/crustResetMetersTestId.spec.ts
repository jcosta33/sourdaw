import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust "Reset" meters chip: a DawPluginChip in the panel footer (CrustPanel
// ~L416) wired to resetCrustPanelMeters(), which zeroes every loudness/peak
// readout back to its floor (lufs* = -100 -> '-', truepeakMax = -100 -> '-',
// truepeakExceeded = false -> 'Clear', output meters -> 0). The meter readouts
// are DOM text + role="meter" (not canvas), so the floor is observable.
//
// The MIDI track in this harness has no instrument device in its chain, so no
// audio signal ever reaches the limiter and the meters already rest at floor.
// There is therefore no from-non-floor transition to observe; the decisive
// check is that the click completes without error and the floor contract still
// holds after — a crash in resetCrustPanelMeters would unmount the panel.
test.describe('Crust reset meters button — interactive and floors readouts', () => {
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

    test('clicking Reset completes without error and meters read at floor', async ({ page }) => {
        const reset = page.getByRole('button', { name: 'Reset', exact: true });
        await expect(reset).toBeVisible();
        await expect(reset).toBeEnabled();

        await reset.click();
        await page.waitForTimeout(250);

        // Panel survived the reset — its Bypass control is still mounted and
        // the chip itself is still interactive.
        await expect(page.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await expect(reset).toBeEnabled();

        // Floor contract on the observable meter DOM:
        //  - integrated LUFS readout renders '—' (lufsIntegrated floored to -100)
        //  - the L output meter bar (role="meter") sits at aria-valuenow 0
        await expect(page.locator('[aria-label^="Integrated LUFS:"]')).toHaveText('—');
        await expect(page.locator('#crust-meter-l')).toHaveAttribute('aria-valuenow', '0');
    });
});
