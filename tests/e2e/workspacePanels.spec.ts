import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Workspace Panels', () => {
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

    test('Can toggle the AI Chat panel', async ({ page }) => {
        const toggleButton = page.getByRole('button', { name: 'Toggle AI chat panel' });
        await expect(toggleButton).toBeVisible();

        // Ensure it's not pressed initially
        const isPressed = await toggleButton.getAttribute('aria-pressed');
        if (isPressed !== 'true') {
            await toggleButton.click();
        }

        // The AI chat panel empty state should appear
        const chatPanelEmptyState = page.getByText('The kitchen is quiet');
        await expect(chatPanelEmptyState).toBeVisible();

        // Check for basic chat UI element (ChatComposer placeholder usually says 'Message...' or similar)
        // ChatComposer uses a standard textarea
        const input = page.getByPlaceholder(/message/i).or(page.getByRole('textbox'));
        await expect(input.first()).toBeVisible();

        // Close it
        await toggleButton.click();
        await expect(chatPanelEmptyState).not.toBeVisible();
    });

    test('Can toggle the Virtual Keyboard', async ({ page }) => {
        const toggleButton = page.getByRole('button', { name: 'Toggle virtual keyboard' });
        await expect(toggleButton).toBeVisible();

        // Click to open
        await toggleButton.click();

        // The virtual keyboard container should appear with the role application
        const keyboardContainer = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboardContainer).toBeVisible();
        
        // Wait for a specific key (C4) to be rendered
        const c4Key = keyboardContainer.getByRole('button', { name: /C4/i });
        await expect(c4Key).toBeVisible();

        // Close it
        await toggleButton.click();
        
        // Wait for the animation to finish closing
        await expect(keyboardContainer).not.toBeVisible();
    });

    test('Can open Session View via bottom tab', async ({ page }) => {
        // Toggle bottom dock open
        const bottomDockButton = page.getByRole('button', { name: 'Toggle bottom dock' });
        await expect(bottomDockButton).toBeVisible();
        await bottomDockButton.click();

        // The bottom dock should now be visible and default to Mixer
        const sessionTabButton = page.getByRole('tab', { name: 'Session', exact: true });
        await expect(sessionTabButton).toBeVisible();

        // Click to open the Session View in the bottom dock
        await sessionTabButton.click();

        // The Session View panel should appear
        // Depending on if the new project creates a default track, we see either the empty state or the grid
        const emptyStateText = page.getByText('No session tracks yet');
        const sceneHeader = page.getByText('Scene', { exact: true });
        
        await expect(emptyStateText.or(sceneHeader)).toBeVisible();

        // Close the bottom dock
        await bottomDockButton.click();
        await expect(emptyStateText.or(sceneHeader)).not.toBeVisible();
    });

    test('Can open Loop Station via bottom tab', async ({ page }) => {
        // Toggle bottom dock open
        const bottomDockButton = page.getByRole('button', { name: 'Toggle bottom dock' });
        await expect(bottomDockButton).toBeVisible();
        await bottomDockButton.click();

        // Click the Loop Station tab
        const loopStationTabButton = page.getByRole('tab', { name: 'Loop Station', exact: true });
        await expect(loopStationTabButton).toBeVisible();
        await loopStationTabButton.click();

        // Check for Loop Station unique UI
        const armButton = page.getByRole('button', { name: /Arm loop station/i });
        await expect(armButton).toBeVisible();

        // Close the bottom dock
        await bottomDockButton.click();
        await expect(armButton).not.toBeVisible();
    });
});
