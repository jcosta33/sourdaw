import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

test.describe('Devices & Routing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Inserting a device adds it to the track chain and updates the UI', async ({ page }) => {
        // Wait for the track to appear in the track list
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const kickTrackRow = trackList.getByRole('row').filter({ hasText: /Kick/i }).first();
        await kickTrackRow.waitFor({ state: 'visible' });

        // Select the Kick track to reveal its inspector. The row wraps a header
        // row and a take lane, so the centre of the row — where a bare row click
        // lands — is inside the take lane and selects nothing; clicking the
        // track name is what selects the track.
        await kickTrackRow.getByText('Kick', { exact: true }).click();

        // The add below is dispatched against whichever track the inspector is
        // showing, so this proof has to observe that it is the Kick track.
        // Without it the whole test passes against whatever track the template
        // left selected.
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('button', { name: 'Kick', exact: true })).toBeVisible();

        // 2. Add a device via the track inspector's Devices section
        const addDeviceButton = inspector.getByLabel('Add device');
        await expect(addDeviceButton).toBeVisible();
        await addDeviceButton.click();

        // Click the 'Grinder' device from the menu
        const grinderItem = page.getByRole('menuitem', { name: /Grinder/i });
        await grinderItem.waitFor({ state: 'visible' });
        await grinderItem.click();

        // 3. Assert the device is inserted into the chain
        // The device's name should appear as a choice card in the devices section
        const deviceCard = inspector.getByText('Grinder', { exact: true });
        await expect(deviceCard).toBeVisible();

        // 4. Test device bypass toggle
        const bypassButton = page.getByLabel('Bypass Grinder');
        await bypassButton.click();

        // Wait for the bypass to apply (aria-label changes to 'Enable')
        const enableButton = page.getByLabel('Enable Grinder');
        await expect(enableButton).toBeVisible();
        await expect(enableButton).toHaveAttribute('aria-pressed', 'true');

        // Un-bypass
        await enableButton.click();

        // Wait for the aria-label to change back to 'Bypass'
        await expect(bypassButton).toBeVisible();
        await expect(bypassButton).toHaveAttribute('aria-pressed', 'false');

        // 5. Test device removal
        const removeButton = page.getByLabel('Remove Grinder');
        await removeButton.click();

        // Assert it is no longer in the DOM
        await expect(deviceCard).not.toBeVisible();
    });
});
