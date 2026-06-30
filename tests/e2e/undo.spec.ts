import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Undo/Redo History', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can perform an action and revert it using the undo button', async ({ page }) => {
        // 1. Initial State
        const addMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await addMidiButton.waitFor({ state: 'visible' });

        // 2. Perform Action: Create a MIDI track
        await addMidiButton.click();

        // The timeline canvas will now be visible
        // Playwright might need to wait for layout, we can use force if it's considered obscured by anything
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        // Right-click the timeline to create a MIDI clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 }, force: true });
        
        // Click 'Add Clip Here'
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        // Wait a tiny bit for the clip to be created
        await page.waitForTimeout(500);

        // Click the clip text to select it securely
        const clipLabel = page.getByText(/New midi clip/i).first();
        await expect(clipLabel).toBeVisible();
        await clipLabel.click({ force: true }); // force click in case it's behind a canvas overlay
        
        // Wait a tiny bit for selection
        await page.waitForTimeout(100);

        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);

        // Duplication creates a new clip, which is an undoable action in the CRDT
        // Press 'Cmd+D' / 'Ctrl+D' to duplicate the selected clip
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
        // Wait for it to be visible first
        const undoButton = page.getByRole('button', { name: 'Undo', exact: true }).or(page.getByTitle(/Undo/i)).first();
        await expect(undoButton).toBeVisible();
        
        // Assert the undo button is ENABLED, proving the action pushed to the stack
        await expect(undoButton).not.toBeDisabled();
        
        // Verify the history list has 'Duplicate clip' or similar
        const historyItem = page.getByRole('button', { name: /clip/i }).first();
        await expect(historyItem).toBeVisible();

        // Click undo
        await undoButton.click();

        // Wait a tiny bit for undo
        await page.waitForTimeout(500);

        // Verify that the Undo button is now disabled (stack empty)
        await expect(undoButton).toBeDisabled();
    });
});
