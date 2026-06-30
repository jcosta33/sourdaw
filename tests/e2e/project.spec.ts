import { test, expect } from '@playwright/test';

import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Project Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
    });

    test('Loading an EDM template populates tracks', async ({ page }) => {
        await launch_from_template({ page, template_name: /EDM/i });

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
        await launch_new_project(page);
        
        // The default empty project has no tracks (Master track is handled separately or in the same list but empty)
        // Let's assert there are no rows in the track list
        const trackList = page.getByRole('grid', { name: /Track list/i });
        const tracks = trackList.getByRole('row');
        await expect(tracks).toHaveCount(0, { timeout: 10000 });
    });
});
