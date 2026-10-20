import { test, expect } from '@playwright/test';

import { add_midi_track, launch_new_project, setupWorkspace } from './e2eUtils';

// ---------------------------------------------------------------------------
// Transport — BPM input, metronome toggle, loop region set.
// These assert real DOM state changes after user interaction, not mere presence.
// ---------------------------------------------------------------------------

test.describe('Transport deep — BPM, metronome, loop', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('BPM spinbutton changes value when incremented via keyboard', async ({ page }) => {
        // The BPM control is a div[role=spinbutton] with aria-valuenow.
        const bpmControl = page.getByRole('spinbutton', { name: /tempo|bpm/i }).first();
        await bpmControl.waitFor({ state: 'visible', timeout: 10_000 });

        // Default is 120.
        await expect(bpmControl).toHaveAttribute('aria-valuenow', '120');

        // Focus and increment via arrow-up (each press = +1 BPM).
        await bpmControl.focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');

        // Assert the value changed to 122.
        await expect(bpmControl).toHaveAttribute('aria-valuenow', '122');
    });

    test('Metronome toggle flips aria-pressed on → off → on', async ({ page }) => {
        const metronome = page.getByRole('button', { name: /metronome/i }).first();
        await metronome.waitFor({ state: 'visible', timeout: 10_000 });

        // Default off (aria-pressed 'false').
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        // Turn on.
        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        // Turn off.
        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('Loop region fill and handles appear while looping and clear when disabled', async ({ page }) => {
        // The ruler mounts with the timeline after a track is added. Fresh view
        // state starts at scrollX=0 and 12 pixels/beat, so this drag commits
        // beats 8–20 and leaves all three sample points in the visible interval.
        await add_midi_track(page);
        const ruler = page.getByLabel('Beat ruler');
        const canvas = ruler.locator('canvas');
        await expect(canvas).toBeVisible();
        const box = await ruler.boundingBox();
        if (!box || box.width < 500) {
            throw new Error('Beat ruler must expose at least 500 visible pixels');
        }

        // y=12 avoids bar labels, beat ticks, and the playhead triangle. The
        // selected x positions sample the left handle, fill, and right handle.
        const sample = async () =>
            canvas.evaluate((element) => {
                const surface = element as HTMLCanvasElement;
                const context = surface.getContext('2d');
                if (!context) {
                    throw new Error('Beat ruler 2D canvas unavailable');
                }
                const scaleX = surface.width / surface.clientWidth;
                const scaleY = surface.height / surface.clientHeight;
                return [97, 150, 238].map((x) =>
                    Array.from(context.getImageData(Math.round(x * scaleX), Math.round(12 * scaleY), 1, 1).data).slice(
                        0,
                        3
                    )
                );
            });

        const loop = page.getByRole('button', { name: 'Loop', exact: true }).first();
        await expect(loop).toBeVisible({ timeout: 10_000 });
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
        const before = await sample();

        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 105, y);
        await page.keyboard.down('Shift');
        await page.mouse.down();
        await page.mouse.move(box.x + 238, y, { steps: 12 });
        await page.mouse.up();
        await page.keyboard.up('Shift');

        await expect(loop).toHaveAttribute('aria-pressed', 'true');
        await expect
            .poll(async () => {
                const during = await sample();
                const blueIncrease = during.map((pixel, index) => pixel[2] - before[index][2]);
                // The faint fill raises blue inside the interval; each opaque
                // accent handle must raise it much more than the fill alone.
                return [
                    blueIncrease[1] > 0,
                    blueIncrease[0] > blueIncrease[1] * 2,
                    blueIncrease[2] > blueIncrease[1] * 2,
                ];
            })
            .toEqual([true, true, true]);

        await loop.click();
        await expect(loop).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(sample).toEqual(before);
    });

    test('Play → Pause → Stop → playhead returns to start', async ({ page }) => {
        const playButton = page.getByRole('button', { name: 'Play', exact: true });
        const stopButton = page.getByRole('button', { name: 'Stop', exact: true });

        const playheadReadout = page.getByRole('button', { name: /Playhead position/i });
        await playButton.waitFor({ state: 'visible' });

        // Play.
        await playButton.click();

        // Pause button should appear.
        const pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
        await expect(pauseButton).toBeVisible();

        // Playhead must have advanced from start.
        await expect(playheadReadout).not.toHaveText(/1\.1\.000/);

        // Stop.
        await stopButton.click();

        // Playhead returns to 1.1.000.
        await expect(playheadReadout).toHaveText(/1\.1\.000/, { timeout: 5000 });

        // Play button is available again.
        await expect(playButton).toBeVisible();
    });
});
