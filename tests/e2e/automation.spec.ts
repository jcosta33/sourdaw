import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Automation Lanes', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can toggle automation lanes and switch parameters', async ({ page }) => {
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

        // Find the automation lane selector in the bottom panel (ClipView)
        // Usually, there is a select box for "Automation lane type"
        const laneSelector = page.getByRole('combobox', { name: /Automation lane type/i });
        await expect(laneSelector).toBeVisible();

        // Check that its default value is Velocity
        await expect(laneSelector).toHaveValue('velocity');

        // Switch to pitch bend or CC
        await laneSelector.selectOption('pitchBend');
        await expect(laneSelector).toHaveValue('pitchBend');

        // The pitch bend automation lane should be visible
        const pitchBendLane = page.locator('[aria-label="Pitch bend automation lane"]');
        await expect(pitchBendLane).toBeVisible();

        const box = await pitchBendLane.boundingBox();
        expect(box).not.toBeNull();

        if (box) {
            // Click to add a point in the pitch bend lane
            await page.mouse.click(box.x + 50, box.y + box.height / 2);
            await page.waitForTimeout(100);
            
            // Drag the point slightly
            await page.mouse.move(box.x + 50, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + 60, box.y + box.height / 2 - 20, { steps: 5 });
            await page.mouse.up();
        }
    });
});
