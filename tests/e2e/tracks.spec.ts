import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Track Management', () => {
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

    test('Can create, rename, duplicate, and delete a track', async ({ page }) => {
        // 1. Create a track
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        // Wait for the first row to be visible and ensure it contains MIDI originally
        const firstTrackRow = trackList.getByRole('row').first();
        await expect(firstTrackRow).toBeVisible();
        await expect(firstTrackRow).toContainText(/MIDI/i);

        // 2. Rename track
        await firstTrackRow.click({ button: 'right' });
        const renameItem = page.getByRole('menuitem', { name: /Rename/i });
        await expect(renameItem).toBeVisible();
        await renameItem.click();

        const renameInput = page.getByRole('menu').getByRole('textbox');
        await expect(renameInput).toBeVisible();
        await renameInput.fill('Synth Lead');
        await renameInput.press('Enter');

        // Wait for rename to apply
        await expect(renameInput).not.toBeVisible();
        await expect(firstTrackRow).toContainText('Synth Lead');

        // Verify there is exactly 1 track named Synth Lead
        const synthLeadTrackNames = trackList.getByTitle('Double-click to rename').filter({ hasText: 'Synth Lead' });
        await expect(synthLeadTrackNames).toHaveCount(1);

        // 3. Duplicate track
        await firstTrackRow.click({ button: 'right' });
        const duplicateItem = page.getByRole('menuitem', { name: /Duplicate Track/i });
        await expect(duplicateItem).toBeVisible();
        await duplicateItem.click();

        // Wait for duplicated track
        await page.waitForTimeout(500);
        await expect(synthLeadTrackNames).toHaveCount(2);
        
        // Find the duplicate row by checking the parent row of the second name
        const duplicatedTrackName = synthLeadTrackNames.nth(1);
        await expect(duplicatedTrackName).toBeVisible();

        // 4. Delete track
        await duplicatedTrackName.click({ button: 'right' });
        const deleteItem = page.getByRole('menuitem', { name: /Delete Track/i });
        await expect(deleteItem).toBeVisible();
        await deleteItem.click();

        // Handle confirmation dialog
        const dialog = page.getByRole('dialog', { name: /Delete/i });
        await expect(dialog).toBeVisible();
        const confirmButton = dialog.getByRole('button', { name: 'Delete' });
        await confirmButton.click();

        // Verify track is deleted
        await expect(synthLeadTrackNames).toHaveCount(1);
    });
});
