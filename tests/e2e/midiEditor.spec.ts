import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('MIDI Editor & Piano Roll', () => {
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

    test('Can open the MIDI editor by double-clicking a MIDI clip', async ({ page }) => {
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

        // Right-click the timeline canvas to create a MIDI clip on the first track
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });

        // Wait for the context menu and click 'Add Clip Here'
        const addClipItem = page.getByRole('menuitem', { name: /Add Clip Here/i });
        await expect(addClipItem).toBeVisible();
        await addClipItem.click();

        // Wait a tiny bit for the clip to be created in the CRDT
        await page.waitForTimeout(500);

        // Double click the newly created clip on the canvas to open the MIDI editor
        await canvas.dblclick({ position: { x: 300, y: 30 } });

        // The Piano roll editor canvas should be visible in the bottom panel
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible();
        
        // Check for the Piano Roll toolbar
        const toolBarItem = page.getByRole('button', { name: /Chord/i });
        await expect(toolBarItem).toBeVisible();
    });
});
