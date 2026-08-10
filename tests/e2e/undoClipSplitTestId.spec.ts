import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A 4-second sine WAV (~8 beats at 120 BPM) so the clip body is wide enough to
// split at a mid-clip cursor position.
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
    await canvas.click({ position: { x: 30, y: 20 } });
    await page.waitForTimeout(300);
    return canvas;
}

// Undo/redo of a clip split: the split is an Automerge transaction (history
// doubles as undo), so undo must restore the single clip and redo re-split.
// Existing undo specs cover note-draw and a generic action; the split mutation
// — a structural clip-count change — is uncovered for the undo round-trip.
test.describe('Undo/redo of clip split', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await setupAudioClip(page);
    });

    test('split → undo restores one clip → redo re-splits to two', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');

        await expect(clipCount).toHaveText(/1 clip/i);

        // Split at a mid-clip cursor (x:60 lands inside the clip body).
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 60, y: 20 } });
        await page.getByRole('menuitem', { name: 'Split at Cursor' }).click();
        await page.waitForTimeout(500);
        await expect(clipCount).toHaveText(/2 clips/i);
        // The split is a transaction, so undo is now usable.
        await expect(undo).toBeEnabled();

        // Undo restores the pre-split state: one clip again.
        await undo.click();
        await page.waitForTimeout(500);
        await expect(clipCount).toHaveText(/1 clip/i);
        await expect(redo).toBeEnabled();

        // Redo re-applies the split: back to two clips.
        await redo.click();
        await page.waitForTimeout(500);
        await expect(clipCount).toHaveText(/2 clips/i);
    });
});
