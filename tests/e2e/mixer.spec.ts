import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Mixer & Routing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the empty project
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-new-project').click();
        
        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();

        // Add a track using the empty state button to have a channel strip
        const emptyStateAudioButton = page.locator('button').filter({ hasText: 'Audio' }).filter({ hasText: 'Record' });
        await emptyStateAudioButton.waitFor({ state: 'visible' });
        await emptyStateAudioButton.click();

        // Wait for the track to appear
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const newTrackRow = trackList.getByRole('row').filter({ hasText: /Audio/i }).first();
        await newTrackRow.waitFor({ state: 'visible' });

        // Open the mixer using the UI button to avoid triggering AI parsing
        await page.getByLabel('Toggle bottom dock').click();

        // Wait for Mixer panel to render
        const mixerPanel = page.getByRole('region', { name: 'Mixer panel' });
        await expect(mixerPanel).toBeVisible();
    });

    test('Can toggle mute and solo on a channel strip', async ({ page }) => {
        // Find the channel strip for the audio track
        const channelStrip = page.getByRole('group', { name: /Audio 1 channel/i });
        await expect(channelStrip).toBeVisible();

        // Find and click the Mute button
        const muteButton = channelStrip.getByRole('button', { name: 'Mute' });
        await expect(muteButton).toBeVisible();
        await muteButton.click();

        // Assert Mute changes state (now aria-label should be 'Unmute')
        const unmuteButton = channelStrip.getByRole('button', { name: 'Unmute' });
        await expect(unmuteButton).toBeVisible();

        // Find and click the Solo button
        const soloButton = channelStrip.getByRole('button', { name: 'Solo' });
        await expect(soloButton).toBeVisible();
        await soloButton.click();

        // Assert Solo changes state
        const unsoloButton = channelStrip.getByRole('button', { name: 'Unsolo' });
        await expect(unsoloButton).toBeVisible();
    });

    test('Can open the output routing menu', async ({ page }) => {
        const channelStrip = page.getByRole('group', { name: /Audio 1 channel/i });
        await expect(channelStrip).toBeVisible();

        // The IO section has a button for Output routing. It displays 'Master' by default.
        const outputButton = channelStrip.getByRole('button', { name: /Master/i }).first();
        await expect(outputButton).toBeVisible();
        await outputButton.click();

        // The routing popup menu should appear with a listbox role
        const routingMenu = page.getByRole('listbox', { name: /Output routing/i });
        await expect(routingMenu).toBeVisible();
        
        // Assert that 'Master' is an option
        const masterOption = routingMenu.getByRole('option', { name: /Master/i });
        await expect(masterOption).toBeVisible();
    });
});