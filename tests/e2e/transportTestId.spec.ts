import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Transport — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('play/pause/stop via test IDs: playhead advances, stops, returns to start', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const stop = page.getByTestId('transport-stop');
        const playhead = page.getByTestId('transport-playhead');

        await expect(play).toBeVisible();

        // Play.
        await play.click();
        await page.waitForTimeout(600);

        // Playhead must have advanced from 1.1.000.
        const movingText = (await playhead.innerText()).trim();
        expect(movingText).not.toMatch(/1\.1\.000/);

        // Stop — playhead returns to start.
        await stop.click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });

        // Play button is available again.
        await expect(play).toBeVisible();
    });

    test('metronome toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const metronome = page.getByTestId('transport-metronome');
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('loop toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const loop = page.getByTestId('transport-loop');
        await expect(loop).toHaveAttribute('aria-pressed', 'false');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'true');

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
    });

    test('BPM spinbutton increments via keyboard', async ({ page }) => {
        const bpm = page.getByTestId('transport-tempo-bpm').getByRole('spinbutton');
        await expect(bpm).toHaveAttribute('aria-valuenow', '120');

        await bpm.focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');

        await expect(bpm).toHaveAttribute('aria-valuenow', '122');
    });

    test('time signature readout shows 4/4 via test ID', async ({ page }) => {
        const timeSig = page.getByTestId('transport-time-signature');
        await expect(timeSig).toBeVisible();
        const text = (await timeSig.innerText()).trim();
        expect(text).toMatch(/4\/4/);
    });
});
