import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust input-gain ("push") strip: a pointer-capture vertical slider rendered by
// CrustGainStrip with role="slider" / aria-label "Input gain". ArrowUp/ArrowDown
// nudge patch.gain by 0.1 dB (Shift = 1 dB) and route through setCrustParamWithAudio
// → crustStore, so the value round-trips back into aria-valuenow. The Push
// MetricTile next to it is a read-only mirror of the same patch.gain; only this
// slider edits it. Unit tests cover the component in isolation; no E2E exercised
// the live store round-trip.
test.describe('Crust input-gain knob — ArrowUp lifts aria-valuenow off 0', () => {
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

    test('ArrowUp raises gain off 0 and ArrowDown returns it', async ({ page }) => {
        const slider = page.getByRole('slider', { name: 'Input gain' });

        // DEFAULT_CRUST_PATCH.gain = 0 → aria-valuenow "0".
        await expect(slider).toHaveAttribute('aria-valuenow', '0');

        // Focus + ArrowUp nudges patch.gain by 0.1 dB through the store.
        await slider.focus();
        await slider.press('ArrowUp');
        await page.waitForTimeout(300);

        const raised = await slider.getAttribute('aria-valuenow');
        expect(Number(raised)).toBeGreaterThan(0);
        await expect(slider).toHaveAttribute('aria-valuenow', '0.1');

        // Round-trip: ArrowDown returns to 0.
        await slider.press('ArrowDown');
        await page.waitForTimeout(300);
        await expect(slider).toHaveAttribute('aria-valuenow', '0');
    });
});
