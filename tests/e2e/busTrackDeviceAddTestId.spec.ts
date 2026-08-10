import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Cross-module depth: devices on bus tracks. Existing device-add E2E (Crust,
// Dutch Oven, Bacteria, etc.) adds devices to MIDI tracks; bus tracks accept
// devices too (trackEligibility.bus.acceptsDeviceAdd) and are the natural home
// for bus-level effects, but no E2E covers that path. This spec creates a bus,
// selects it, adds a device via the inspector, and asserts the device card
// lands on the bus (the bus's bypass count rises).
test.describe('Bus track — device add lands on the bus chain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'Audio');
        // Create a bus via the inspector's Create Bus button.
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Create Bus' }).click();
        await expect(page.getByRole('grid', { name: /Track list/i }).getByText('Bus 1', { exact: true }).first()).toBeVisible({
            timeout: 5000,
        });
    });

    test('adding Gluten to the bus creates a Bypass Gluten toggle on the bus chain', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        // Select the bus row so the inspector targets it.
        await trackList.getByText('Bus 1', { exact: true }).first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const devicesBefore = await inspector.getByRole('button', { name: /^Bypass /i }).count();

        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
        await page.waitForTimeout(800);

        // The device card lands on the bus chain: count rises by one and a
        // Bypass Gluten toggle appears — proving device-add works on bus tracks,
        // not just MIDI/audio.
        await expect(inspector.getByRole('button', { name: /^Bypass Gluten$/i })).toBeVisible();
        const devicesAfter = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devicesAfter).toBe(devicesBefore + 1);
    });
});
