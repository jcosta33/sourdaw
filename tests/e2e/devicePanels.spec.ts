import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Device Panels & Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the empty project
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-new-project').click();
        
        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Can toggle the Inspector panel', async ({ page }) => {
        // Add a new Audio track to populate the inspector
        const addAudioButton = page.locator('button').filter({ hasText: 'Audio' }).filter({ hasText: 'Record or import' });
        await addAudioButton.waitFor({ state: 'visible' });
        await addAudioButton.click();

        // The inspector button might be disabled or have different states if no track is selected,
        // but creating a track usually selects it automatically.
        const inspectorToggle = page.getByRole('button', { name: 'Toggle inspector' });
        await expect(inspectorToggle).toBeVisible();

        // Ensure it's not open by default (if the workspace starts with it closed)
        const isPressed = await inspectorToggle.getAttribute('aria-pressed');
        if (isPressed !== 'true') {
            await inspectorToggle.click();
        }

        // Verify the Inspector surface opens
        const inspectorPanel = page.getByLabel('Inspector panel');
        await expect(inspectorPanel).toBeVisible();

        // Check for basic track inspector elements
        const colorLabel = inspectorPanel.getByText('Color', { exact: true }).first();
        await expect(colorLabel).toBeVisible();

        // Close the panel
        await inspectorToggle.click();
        await expect(inspectorPanel).not.toBeVisible();
    });
});
