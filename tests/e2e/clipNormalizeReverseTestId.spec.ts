import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A 2-second sine WAV so the clip has audio content to normalize/reverse.
function buildSineWav(seconds = 2): Buffer {
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

async function setupAudioClip(page: import('@playwright/test').Page): Promise<void> {
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
}

// Clip audio operations: the context menu has Normalize and Reverse items for
// audio clips. Existing specs assert Reverse *appears* in the menu but never
// execute it. This imports an audio clip, right-clicks it, clicks Normalize,
// and asserts the action completes without error (no crash, clip still present).
test.describe('Clip audio ops — Normalize + Reverse', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await setupAudioClip(page);
    });

    test('Normalize completes without crashing the clip', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        await expect(clipCount).toHaveText(/1 clip/i);

        // Right-click the clip and choose Normalize.
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 30, y: 20 }, force: true });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const normalizeItem = page.getByRole('menuitem', { name: 'Normalize' }).filter({ hasText: /Normalize/ });
        await expect(normalizeItem).toBeVisible();
        await normalizeItem.dispatchEvent('click');
        await page.waitForTimeout(1000);

        // The clip is still present — no crash.
        await expect(clipCount).toHaveText(/1 clip/i);
    });

    test('Reverse completes without crashing the clip', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        await expect(clipCount).toHaveText(/1 clip/i);

        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 30, y: 20 }, force: true });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const reverseItem = page.getByRole('menuitem', { name: 'Reverse' }).filter({ hasText: /Reverse/ });
        await expect(reverseItem).toBeVisible();
        await reverseItem.dispatchEvent('click');
        await page.waitForTimeout(1000);

        // The clip is still present — no crash.
        await expect(clipCount).toHaveText(/1 clip/i);
    });
});
