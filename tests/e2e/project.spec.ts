import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Project Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
    });

    test('Loading an EDM template populates tracks', async ({ page }) => {
        // Open the templates grid from the Launch Screen
        await page.locator('#launch-from-template').click();
        
        // Wait for the templates grid to load
        await expect(page.getByText('Start a new project')).toBeVisible();

        // Click the EDM template
        const edmTemplateButton = page.getByRole('button', { name: /EDM/i });
        await edmTemplateButton.waitFor({ state: 'visible' });
        await edmTemplateButton.click();

        // Wait for the "Baking" loading state to confirm the click
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });

        // Wait for the main workspace to load
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();

        // Assert that tracks were created by looking for track headers.
        // A template like EDM should have multiple tracks, e.g. 'Kick', 'Bass', etc.
        const trackList = page.getByRole('grid', { name: /Track list/i });
        const tracks = trackList.getByRole('row');
        await expect(tracks).not.toHaveCount(0, { timeout: 15000 });
        
        // Expect at least 3 tracks in the EDM template
        const count = await tracks.count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('New Project flow clears the timeline', async ({ page }) => {
        // First load the empty project
        await page.locator('#launch-new-project').click();
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        
        // The default empty project has no tracks (Master track is handled separately or in the same list but empty)
        // Let's assert there are no rows in the track list
        const trackList = page.getByRole('grid', { name: /Track list/i });
        const tracks = trackList.getByRole('row');
        await expect(tracks).toHaveCount(0, { timeout: 10000 });
    });
});
