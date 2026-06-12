import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Transport & Engine', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Bypass the Launch Screen
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-new-project').click();
        
        // Ensure the click was registered and the animation starts
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });

        // We don't wait for LaunchScreen to unmount because it might stay in the DOM 
        // with opacity: 0 if the exit animation timeout is cancelled by store updates.
        // Playwright will automatically wait until it stops intercepting pointer events.
        
        // Wait for the main workspace to load
        // Transport controls are in the main app shell
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Toggling play/pause updates UI state and playhead position', async ({ page }) => {
        const playButton = page.getByRole('button', { name: 'Play', exact: true });
        const pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
        const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
        
        // The playhead segmented readout
        const playheadReadout = page.getByRole('button', { name: /Playhead position/i });

        // Initial state: stopped
        await expect(playButton).toBeVisible();
        await expect(pauseButton).not.toBeVisible();
        
        // Capture initial playhead text (e.g., "1.1.000")
        const initialPlayheadText = await playheadReadout.innerText();

        // 1. Click Play
        await playButton.click();
        
        // Assert UI updates to Pause
        await expect(pauseButton).toBeVisible();
        await expect(playButton).not.toBeVisible();

        // Wait a short moment for the playhead to move (engine running)
        // Since playhead updates via requestAnimationFrame, we wait for the text to change
        await expect(playheadReadout).not.toHaveText(initialPlayheadText, { timeout: 2000 });
        
        const movingPlayheadText = await playheadReadout.innerText();

        // 2. Click Pause
        await pauseButton.click();
        
        // Assert UI updates back to Play
        await expect(playButton).toBeVisible();
        await expect(pauseButton).not.toBeVisible();

        // Wait a moment and assert playhead stopped moving
        // We wait slightly longer so any pending requestAnimationFrames complete
        await page.waitForTimeout(400);
        const pausedPlayheadText = await playheadReadout.innerText();
        
        // Assert it's not still at the start
        expect(pausedPlayheadText).not.toEqual(initialPlayheadText);
        
        // Check that it's actually stable (hasn't moved after another short wait)
        await page.waitForTimeout(200);
        const stablePlayheadText = await playheadReadout.innerText();
        expect(stablePlayheadText).toEqual(pausedPlayheadText);

        // 3. Click Stop (returns to beginning)
        await stopButton.click();
        
        // Assert playhead returns to initial position (it may format as 'Bars1.1.000' or with newlines)
        await expect(playheadReadout).toHaveText(/1\.1\.000/);
    });
});
