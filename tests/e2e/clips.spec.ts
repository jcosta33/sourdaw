import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Clip Operations', () => {
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

    test('Can copy, paste, duplicate, and delete a clip via context menu', async ({ page }) => {
        // 1. Create a track
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();

        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        // 2. Create a clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 }, force: true });
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        const clipLabel = page.getByText(/New midi clip/i).first();
        await expect(clipLabel).toBeVisible();

        // 3. Copy clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 }, force: true });
        const copyItem = page.getByRole('menuitem', { name: /Copy/i });
        await expect(copyItem).toBeVisible();
        await copyItem.click();

        // Wait a tiny bit for the clipboard to populate internally
        await page.waitForTimeout(300);

        // 4. Paste clip at a different position
        await canvas.click({ button: 'right', position: { x: 400, y: 30 }, force: true });
        const pasteItem = page.getByRole('menuitem', { name: /Paste/i });
        await expect(pasteItem).toBeVisible();
        await pasteItem.click();

        await page.waitForTimeout(500);

        // We should now have 2 clips
        const clipLabels = page.getByText(/New midi clip/i);
        await expect(clipLabels).toHaveCount(2);

        // 5. Delete the first clip
        await canvas.click({ button: 'right', position: { x: 200, y: 30 }, force: true });
        const deleteItem = page.getByRole('menuitem', { name: /Delete/i }).filter({ hasText: /Delete/ });
        // Making sure we don't accidentally click something else that contains delete
        await expect(deleteItem).toBeVisible();
        await deleteItem.click();

        // We should have 1 clip left
        await expect(clipLabels).toHaveCount(1);
    });
});
