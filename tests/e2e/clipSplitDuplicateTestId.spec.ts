import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A 4-second sine WAV (~8 beats at 120 BPM) so the clip has a wide body to
// split in the middle and room to duplicate without overlapping the original.
function buildSineWav(seconds = 4): Buffer {
    const sampleRate = 44100;
    const samples = Math.floor(sampleRate * seconds);
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i += 1) {
        buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
    }
    return buffer;
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const ALT = process.platform === 'darwin' ? 'Alt' : 'Alt';

// Set up an audio track with an imported clip, open the bottom dock's Editor
// tab so the ClipView strip mounts (its `selected-track-clip-count` readout is
// the observable state), and select the clip. Returns the timeline canvas.
async function setupAudioClip(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
    await page.keyboard.press(`${MOD}+K`);
    const paletteInput = page.getByTestId('command-palette-input');
    await paletteInput.fill('Add Audio Track');
    await page.waitForTimeout(300);
    await paletteInput.press('Enter');
    await page.waitForTimeout(800);

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: buildSineWav() });
    await page.waitForTimeout(2000);

    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.waitForTimeout(400);

    const canvas = page.getByLabel('Timeline editor surface');
    // Select the clip at the left edge of the lane.
    await canvas.click({ position: { x: 30, y: 20 } });
    await page.waitForTimeout(300);
    return canvas;
}

// Clip split + duplicate-to-next-bar are uncovered clip operations: the context
// menu's "Split at Cursor" is only name-checked elsewhere, and duplicate-to-
// next-bar (⌥D) has no E2E. Both are observable through the ClipView clip-count
// readout (1 clip → 2 clips).
test.describe('Clip split + duplicate to next bar', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await setupAudioClip(page);
    });

    test('Split at Cursor turns one clip into two', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        // One clip on the selected track before the split.
        await expect(clipCount).toHaveText(/1 clip/i);

        // Right-click on the clip body sets the split beat to that cursor
        // position; the context menu's Split at Cursor splits there. The clip
        // starts at beat 0 and its rendered body covers roughly the first ~90px
        // of the lane, so x:60 lands inside it (past the very start, so the
        // split is non-degenerate).
        const canvas = page.getByLabel('Timeline editor surface');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        await canvas.click({ button: 'right', position: { x: 60, y: 20 } });
        await page.getByRole('menuitem', { name: 'Split at Cursor' }).click();
        await page.waitForTimeout(500);

        // The split produces two clips on the track — a real count delta.
        await expect(clipCount).toHaveText(/2 clips/i);
    });

    test('Duplicate to Next Bar (⌥D) adds a second clip', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        await expect(clipCount).toHaveText(/1 clip/i);

        // ⌥D is the shortcut for duplicate-to-next-bar; it appends a copy of
        // the selected clip at the next bar line.
        await page.keyboard.press(`${ALT}+D`);
        await page.waitForTimeout(500);

        // The duplicate lands as a second clip on the same track.
        await expect(clipCount).toHaveText(/2 clips/i);
    });
});
