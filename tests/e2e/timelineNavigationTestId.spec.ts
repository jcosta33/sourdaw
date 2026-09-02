import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Timeline navigation — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track so the timeline has content.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    });

    test('timeline minimap is in the DOM via test ID', async ({ page }) => {
        const minimap = page.getByTestId('timeline-minimap');
        await expect(minimap).toBeAttached({ timeout: 10_000 });
    });

    test('minimap has slider role and aria-valuenow', async ({ page }) => {
        const minimap = page.getByTestId('timeline-minimap');
        await expect(minimap).toBeAttached({ timeout: 10_000 });

        // It should have the slider role.
        const role = await minimap.getAttribute('role');
        expect(role).toBe('slider');

        // Scroll starts at 0 (timelineViewStore's default view state), and
        // TimelineMinimap.tsx derives aria-valuenow from
        // `Math.round((scrollX / ...) * 100)`, so a fresh project reads 0.
        await expect(minimap).toHaveAttribute('aria-valuenow', '0');
    });

    test('timeline canvas surface is present', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible({ timeout: 10_000 });

        // The canvas should have rendered content.
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
    });

    test('playhead display shows initial position 1.1.000', async ({ page }) => {
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).toBeVisible({ timeout: 10_000 });
        await expect(playhead).toHaveText(/1\.1\.000/);
    });
});
