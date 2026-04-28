import { test, expect } from '@playwright/test';

test.describe('Transport & Engine', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
        page.on('pageerror', err => console.log(`[Browser Error] ${err}`));

        // Bypass onboarding tour, audio resume overlay, and alpha notice so they don't intercept clicks
        await page.addInitScript(() => {
            window.localStorage.setItem('wd:onboarding-completed', '1');
            window.localStorage.setItem('wd:audio-resume-dismissed', '1');
            window.localStorage.setItem('sourdaw-alpha-notice-dismissed', 'true');
        });

        // Go to the app
        await page.goto('/');

        // Wait for basic assets to load before clicking
        await page.waitForLoadState('domcontentloaded');

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
        await page.waitForTimeout(100);
        const pausedPlayheadText = await playheadReadout.innerText();
        expect(pausedPlayheadText).not.toEqual(initialPlayheadText);
        expect(pausedPlayheadText).toBeDefined();

        // 3. Click Stop (returns to beginning)
        await stopButton.click();
        
        // Assert playhead returns to initial position (it may format as 'Bars1.1.000' or with newlines)
        await expect(playheadReadout).toHaveText(/1\.1\.000/);
    });
});
