import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A 2-second sine WAV (~4 beats at 120 BPM) so the clip has a wide enough body
// to grab and drag on the timeline.
function buildDragWav(): Buffer {
    const sampleRate = 44100;
    const samples = Math.floor(sampleRate * 2);
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

// Set up an audio track with an imported clip, open the bottom dock's Editor
// tab so the ClipView strip mounts, and select the clip. Returns the timeline
// canvas locator.
async function setupAudioClipForDrag(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
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
    await fileChooser.setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: buildDragWav() });
    await page.waitForTimeout(2000);

    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.waitForTimeout(400);

    const canvas = page.getByLabel('Timeline editor surface');
    // Select the clip (it sits at beat 0, near the left edge of the lane).
    await canvas.click({ position: { x: 30, y: 20 } });
    await page.waitForTimeout(300);
    return canvas;
}

test.describe('Clip drag / move on the timeline', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await setupAudioClipForDrag(page);
    });

    test('dragging a clip rightward increases its start beat', async ({ page }) => {
        const startBeat = page.getByTestId('selected-clip-start-beat');
        // The imported clip starts at beat 0.
        await expect(startBeat).toHaveText(/@ 0 beats/i);

        const canvas = page.getByLabel('Timeline editor surface');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();

        // Grab the clip body and drag it rightward. The clip occupies the left
        // edge of the lane, so start the pointer-down within its body.
        const startX = box!.x + 30;
        const y = box!.y + 20;
        await page.mouse.move(startX, y);
        await page.mouse.down();
        for (let step = 1; step <= 10; step += 1) {
            await page.mouse.move(startX + step * 15, y);
            await page.waitForTimeout(25);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);

        // The start beat readout now reflects the moved position — greater than 0.
        const afterText = await startBeat.innerText();
        const afterBeat = Number(afterText.match(/-?\d+(\.\d+)?/)?.[0] ?? '0');
        expect(afterBeat).toBeGreaterThan(0);
    });

    test('dragging a clip moves it without duplicating', async ({ page }) => {
        const startBeat = page.getByTestId('selected-clip-start-beat');
        const clipCount = page.getByTestId('selected-track-clip-count');
        await expect(startBeat).toHaveText(/@ 0 beats/i);
        const countBefore = await clipCount.innerText();

        const canvas = page.getByLabel('Timeline editor surface');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const startX = box!.x + 30;
        const y = box!.y + 20;

        await page.mouse.move(startX, y);
        await page.mouse.down();
        for (let step = 1; step <= 10; step += 1) {
            await page.mouse.move(startX + step * 15, y);
            await page.waitForTimeout(25);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);

        // The clip moved (start beat > 0)…
        const afterText = await startBeat.innerText();
        const afterBeat = Number(afterText.match(/-?\d+(\.\d+)?/)?.[0] ?? '0');
        expect(afterBeat).toBeGreaterThan(0);
        // …and the track still holds the same number of clips — a plain drag
        // moves, it does not duplicate (Alt+drag would).
        await expect(clipCount).toHaveText(countBefore);
    });
});
