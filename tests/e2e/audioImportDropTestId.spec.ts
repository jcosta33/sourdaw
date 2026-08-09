import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A minimal valid WAV: 44-byte header + mono 16-bit PCM at 44100 Hz. Built in
// the test process so no binary fixture is committed.
function buildWavBytes(): Buffer {
    const sampleRate = 44100;
    const seconds = 1;
    const samples = sampleRate * seconds;
    const dataSize = samples * 2; // 16-bit
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // A low-amplitude sine so the clip carries real audio (not pure silence),
    // which downstream consumers (e.g. Knead analysis) can read.
    for (let i = 0; i < samples; i += 1) {
        const value = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 6000);
        buffer.writeInt16LE(value, 44 + i * 2);
    }
    return buffer;
}

async function openTrackMenu(page: import('@playwright/test').Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const row = trackList.getByRole('row').first();
    await row.click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
}

test.describe('Audio clip import — context menu Import Audio', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        // Need a track to import into.
        const midi = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await midi.click();
        await page.getByRole('grid', { name: /Track list/i }).first().getByRole('row').first().waitFor({ state: 'visible' });
    });

    test('importing a WAV adds an audio clip to the track', async ({ page }) => {
        // Import FIRST, while the layout is stable and the context-menu click
        // lands reliably on the track row.
        await openTrackMenu(page);
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import Audio/i }).click();
        const fileChooser = await chooser;
        await fileChooser.setFiles({
            name: 'probe.wav',
            mimeType: 'audio/wav',
            buffer: buildWavBytes(),
        });
        await page.waitForTimeout(1500);

        // The clip-count readout lives in the ClipView strip, mounted under the
        // bottom dock's Editor tab. Open the dock and select that tab.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click(); // re-select the track
        const dockToggle = page.getByTestId('toggle-bottom-dock');
        if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
            await dockToggle.click();
            await page.waitForTimeout(400);
        }
        await page.getByRole('tab', { name: 'Editor' }).click();
        await page.waitForTimeout(400);

        // The imported audio clip lands on the track: the count readout reads
        // 1 clip (not 0) — the state change that proves the import.
        await expect(page.getByTestId('selected-track-clip-count')).toHaveText(/1 clip/i, { timeout: 15_000 });
    });
});
