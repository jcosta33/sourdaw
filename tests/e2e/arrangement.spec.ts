import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Arranger & Timeline', () => {
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

    test('Can perform basic timeline selection and clip context menu interactions', async ({ page }) => {
        // 1. Add a track using the empty state button
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();

        // Wait for the track to appear
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const newTrackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();
        await newTrackRow.waitFor({ state: 'visible' });

        // Now that there is a user track, the timeline canvas will be rendered
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible();

        // 2. Right click the timeline canvas to create a MIDI clip on the new track
        // The canvas is a flex-1 container below the headers, so y=0 is the top of the first track.
        // We right-click at y=30 to hit the middle of the first track.
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });

        // Wait for the empty space context menu and click 'Add Clip Here'
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        // Wait a tiny bit for the clip to be created in the CRDT
        await page.waitForTimeout(500);

        // 3. Right-click the newly created clip to rename it
        await canvas.click({ button: 'right', position: { x: 200, y: 30 } });

        // Wait for the clip context menu to appear
        const renameItem = page.getByRole('menuitem', { name: /Rename Clip/i });
        await expect(renameItem).toBeVisible();
        await renameItem.click();

        // The inline rename editor should appear
        const renameInput = page.getByRole('menu').getByRole('textbox');
        await expect(renameInput).toBeVisible();
        
        await renameInput.fill('My New Clip');
        await renameInput.press('Enter');

        // Verify the inline editor closed
        await expect(renameInput).not.toBeVisible();

        // 4. Perform a basic selection (marquee drag)
        // Drag from an empty space to select the clip
        await page.mouse.move(100, 100);
        await page.mouse.down();
        await page.mouse.move(300, 200, { steps: 10 });
        await page.mouse.up();
    });
});
