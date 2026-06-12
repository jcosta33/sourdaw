import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Recording Transport', () => {
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

    test('Can toggle global transport recording', async ({ page }) => {
        // Find the transport bar Record button (not the empty state one)
        // Since it's a latch button, we can find it by its ARIA pressed state or its precise name.
        // Sourdaw sets aria-label to 'Record' or 'Stop recording'
        const recordButton = page.getByRole('button', { name: 'Record', exact: true }).or(page.getByRole('button', { name: 'Stop recording', exact: true }));
        await expect(recordButton).toBeVisible();

        // Ensure it's not recording initially
        await expect(recordButton).toHaveAttribute('aria-pressed', 'false');

        // Click Record
        await recordButton.click();

        // The button state should update
        await expect(recordButton).toHaveAttribute('aria-pressed', 'true');

        // Stop Recording
        await recordButton.click();

        // The button state should revert
        await expect(recordButton).toHaveAttribute('aria-pressed', 'false');
    });
});
