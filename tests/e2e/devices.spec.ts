import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Devices & Routing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the EDM template to guarantee we have tracks to work with
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        
        const edmTemplateButton = page.getByRole('button', { name: /EDM/i });
        await edmTemplateButton.waitFor({ state: 'visible' });
        await edmTemplateButton.click();
        
        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Inserting a device adds it to the track chain and updates the UI', async ({ page }) => {
        // Wait for the track to appear in the track list
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const kickTrackRow = trackList.getByRole('row').filter({ hasText: /Kick/i }).first();
        await kickTrackRow.waitFor({ state: 'visible' });

        // Select the Kick track to reveal its inspector
        await kickTrackRow.click();

        // 2. Add a device via the track inspector's Devices section
        const addDeviceButton = page.getByLabel('Add device');
        await expect(addDeviceButton).toBeVisible();
        await addDeviceButton.click();

        // Click the 'Grinder' device from the menu
        const grinderItem = page.getByRole('menuitem', { name: /Grinder/i });
        await grinderItem.waitFor({ state: 'visible' });
        await grinderItem.click();

        // 3. Assert the device is inserted into the chain
        // The device's name should appear as a choice card in the devices section
        const deviceCard = page.getByText('Grinder', { exact: true });
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
