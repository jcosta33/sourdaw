import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Command Palette', () => {
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

    test('Can open the command palette and execute a command', async ({ page }) => {
        // Press 'Cmd+K' / 'Ctrl+K' to open the Command Palette
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const palette = page.getByRole('dialog', { name: /Command Palette/i });
        await expect(palette).toBeVisible();

        const input = palette.getByPlaceholder(/Type a command/i);
        await expect(input).toBeFocused();

        // Search for a command
        await input.fill('Add Audio Track');

        // Wait for the list to filter
        const option = palette.getByRole('option', { name: /Add Audio Track/i });
        await expect(option).toBeVisible();

        // Execute by pressing Enter
        await page.keyboard.press('Enter');

        // The palette should close
        await expect(palette).not.toBeVisible();

        // Verify the command was executed by checking if an Audio track was created
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const newTrackRow = trackList.getByRole('row').filter({ hasText: /Audio/i }).first();
        await expect(newTrackRow).toBeVisible();
    });
});
