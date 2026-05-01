import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Undo/Redo History', () => {
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

    test('Can perform an action and revert it using the undo button', async ({ page }) => {
        // Create a MIDI track
        const addMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await addMidiButton.waitFor({ state: 'visible' });
        await addMidiButton.click();

        // The timeline canvas will now be visible
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        // Right-click the timeline to create a MIDI clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });
        
        // Click 'Add Clip Here'
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        // Wait a tiny bit for the clip to be created
        await page.waitForTimeout(500);

        // Click the clip on the canvas to select it (it was created at the mouse position)
        await canvas.click({ position: { x: 200, y: 30 } });

        // Duplication creates a new clip. We can observe DOM changes or just trust the Undo button
        // Press 'Cmd+D' / 'Ctrl+D' to duplicate the selected clip
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+D' : 'Control+D');

        // Wait a tiny bit for duplication to complete
        await page.waitForTimeout(500);

        // Open the undo history panel
        const toggleHistoryButton = page.getByRole('button', { name: /Toggle undo history panel/i });
        await toggleHistoryButton.click();

        // The undo history panel should be visible
        const panelTitle = page.getByText('Undo History', { exact: true });
        await expect(panelTitle).toBeVisible();

        // Click the Undo button (global transport undo)
        const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undoButton).toBeVisible();
        
        // Assert the undo button is ENABLED, proving the action pushed to the stack
        await expect(undoButton).not.toBeDisabled();
        await undoButton.click();

        // Wait a tiny bit for undo
        await page.waitForTimeout(500);

        // Verify that the Undo button is now disabled (stack empty)
        await expect(undoButton).toBeDisabled();
    });
});
