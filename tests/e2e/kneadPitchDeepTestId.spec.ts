import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// A short mono sine WAV (440 Hz, 0.5 s) — long enough to produce a voiced pitch
// contour, short enough to keep WASM analysis well under the test timeout.
function buildPitchWav(): Buffer {
    const sampleRate = 44100;
    const seconds = 0.5;
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

// Drive an audio clip through the Knead pitch editor and wait for analysis to
// expose its controls. Returns once the "Correct All" button is visible.
async function openPitchEditorWithAudio(page: import('@playwright/test').Page): Promise<void> {
    // Add an audio track via the command palette (the clip view's Knead button
    // only appears for audio-kind tracks).
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    const paletteInput = page.getByTestId('command-palette-input');
    await paletteInput.fill('Add Audio Track');
    await page.waitForTimeout(300);
    await paletteInput.press('Enter');
    await page.waitForTimeout(800);

    // Import the sine WAV onto the new track.
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: buildPitchWav() });
    await page.waitForTimeout(2000);

    // Open the bottom dock's Editor tab so the ClipView strip mounts.
    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.waitForTimeout(400);

    // Select the imported clip by double-clicking where it landed.
    const canvas = page.getByLabel('Timeline editor surface');
    for (const x of [40, 80, 120]) {
        await canvas.dblclick({ position: { x, y: 20 } });
        await page.waitForTimeout(400);
        if (await page.getByRole('button', { name: /Knead/i }).isVisible().catch(() => false)) {
            break;
        }
    }

    // Switch the clip view to the pitch editor and enable Knead.
    await page.getByRole('button', { name: /Knead \(Pitch\)/i }).click();
    await page.waitForTimeout(600);
    const enable = page.getByRole('button', { name: /Enable Pitch Editor/i });
    if (await enable.isVisible().catch(() => false)) {
        await enable.click();
    }

    // Analysis runs on enable; the controls render once blobs exist.
    await expect(page.getByRole('button', { name: /Correct All/i })).toBeVisible({ timeout: 30_000 });
}

test.describe('Knead pitch-correction editor — deep', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPitchEditorWithAudio(page);
    });

    test('analysis exposes the Correct All action', async ({ page }) => {
        // The Correct All button presence proves pitch analysis completed and
        // produced editable blobs (it only renders when blobs.length > 0).
        await expect(page.getByRole('button', { name: /Correct All/i })).toBeVisible();
        // The retune and humanize controls are part of the same gate.
        await expect(page.getByText('Retune', { exact: true })).toBeVisible();
        await expect(page.getByText('Human', { exact: true })).toBeVisible();
    });

    test('Correct All reports a scale-correction result', async ({ page }) => {
        // Correct All notifies on success; the toast carries the message.
        const correctAll = page.getByRole('button', { name: /Correct All/i });
        await correctAll.click();
        await expect(page.getByText(/Pitch corrected to scale/i)).toBeVisible({ timeout: 10_000 });
    });

    test('Formants checkbox toggles its checked state', async ({ page }) => {
        const formants = page.getByRole('checkbox', { name: /Formants/i });
        await formants.waitFor({ state: 'visible' });
        const before = await formants.getAttribute('aria-checked');
        await formants.click();
        await expect(formants).not.toHaveAttribute('aria-checked', before ?? '');
    });
});
