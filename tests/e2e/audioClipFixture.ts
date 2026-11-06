import { type Page } from '@playwright/test';

import { expect } from './e2eTest';

/** A mono 16-bit 44.1 kHz sine WAV, for specs that import an audio clip through the file chooser. */
export function buildSineWav(seconds = 2): Buffer {
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

/**
 * Add an audio track, import a generated sine WAV onto it, and select the
 * imported clip so the clip inspector renders. Retries the canvas click since
 * clips are canvas-rendered and the first click can miss.
 */
export async function import_and_select_audio_clip(page: Page): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+K`);
    const paletteInput = page.getByTestId('command-palette-input');
    await paletteInput.fill('Add Audio Track');
    await page.getByRole('option', { name: 'Add Audio Track' }).waitFor({ state: 'visible' });
    await paletteInput.press('Enter');

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: buildSineWav() });

    const timeline = page.getByLabel('Timeline editor surface');
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const clipContent = inspector.getByText(/Clip Gain|Trim Start/i).first();
    await expect(async () => {
        await timeline.click({ position: { x: 30, y: 20 } });
        await expect(clipContent).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
}
