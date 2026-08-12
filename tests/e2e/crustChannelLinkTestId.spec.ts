import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// The Crust channel-link controls (channelLinkTransient / channelLinkRelease)
// are Radix Slider thumbs rendered by SliderRow in CrustControlZone — not
// DawPluginChip toggles — so the a11y surface is aria-valuenow, not aria-pressed.
// Default for both is 100 (CrustPatch.ts); Home/End snap a Radix slider to its
// min/max, giving a deterministic round-trip without pointer-coordinate math.
test.describe('Crust channel-link slider — value round-trip', () => {
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

    test('Link Trans slider flips aria-valuenow off max then back', async ({ page }) => {
        const slider = page.getByRole('slider', { name: 'Link Trans', exact: true });

        // Default channelLinkTransient is 100 → thumb reports aria-valuenow "100".
        await expect(slider).toHaveAttribute('aria-valuenow', '100');

        // Home snaps the Radix slider to its min (0).
        await slider.press('Home');
        await page.waitForTimeout(300);
        await expect(slider).toHaveAttribute('aria-valuenow', '0');

        // End snaps it back to max (100).
        await slider.press('End');
        await page.waitForTimeout(300);
        await expect(slider).toHaveAttribute('aria-valuenow', '100');
    });
});
