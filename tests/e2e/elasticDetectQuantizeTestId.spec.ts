import { test, expect, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// Four percussive bursts (decaying 1 kHz tones) separated by silence. The
// Elastic detect button runs a spectral-flux onset detector over the decoded
// buffer; a continuous sine would give it no onset to find, so the clip needs
// discrete attacks for Detect to produce transient markers.
function buildPercussiveWav(): Buffer {
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
    const burstStarts = [0.25, 0.75, 1.25, 1.75];
    const burstLength = Math.floor(sampleRate * 0.05);
    for (const start of burstStarts) {
        const offset = Math.floor(start * sampleRate);
        for (let i = 0; i < burstLength; i += 1) {
            const envelope = Math.exp(-6 * (i / burstLength));
            const value = Math.round(Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 14000 * envelope);
            buffer.writeInt16LE(value, 44 + (offset + i) * 2);
        }
    }
    return buffer;
}

// Add an Audio track, import the percussive WAV, select the imported clip on
// the timeline (the Elastic tab only renders with an audio clip selected), then
// open the bottom dock's Elastic tab. Returns the mounted Elastic editor panel.
async function setupElasticEditorWithAudioClip(page: Page): Promise<Locator> {
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
    await fileChooser.setFiles({ name: 'bursts.wav', mimeType: 'audio/wav', buffer: buildPercussiveWav() });
    await page.waitForTimeout(2000);

    // The imported clip sits at beat 0 near the left edge of the lane.
    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ position: { x: 30, y: 20 } });
    await page.waitForTimeout(300);

    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }

    const elasticTab = page.locator('#bottom-dock-tab-elastic');
    await elasticTab.waitFor({ state: 'visible', timeout: 10_000 });
    await elasticTab.click();
    const panel = page.getByTestId('elastic-editor-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    return panel;
}

test.describe('Elastic audio detect / quantize / sensitivity', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await setupElasticEditorWithAudioClip(page);
    });

    test('detect button is visible and enabled, quantize visible', async ({ page }) => {
        const detect = page.getByTestId('elastic-detect-button');
        const quantize = page.getByTestId('elastic-quantize-button');
        await expect(detect).toBeVisible();
        await expect(detect).toBeEnabled();
        await expect(quantize).toBeVisible();
        // Quantize stays inert until detection has produced markers
        // (`quantizeDisabled = !detected || markers.length === 0`).
        await expect(quantize).toBeDisabled();
    });

    test('clicking detect keeps the panel mounted and enables quantize', async ({ page }) => {
        const panel = page.getByTestId('elastic-editor-panel');
        const detect = page.getByTestId('elastic-detect-button');
        const quantize = page.getByTestId('elastic-quantize-button');
        const detailStrip = page.getByTestId('elastic-detail-strip');

        await detect.click();
        await page.waitForTimeout(500);

        // No crash: the panel (and its detail strip) stay mounted, and the
        // detection ran — the strip reports at least one transient marker.
        await expect(panel).toBeVisible();
        await expect(detailStrip).toBeVisible();
        await expect(detailStrip).toHaveText(/[1-9]\d* transients?, 0 user, 0 locked/);

        // The observable state change: quantize unlocks once detection
        // produced markers.
        await expect(quantize).toBeEnabled();

        await quantize.click();
        await page.waitForTimeout(300);
        // Quantize snaps markers to the grid without taking the panel down.
        await expect(panel).toBeVisible();
    });

    test('arrow key on the sensitivity slider changes its value', async ({ page }) => {
        const slider = page.getByRole('slider', { name: 'Transient detection sensitivity' });
        await expect(slider).toBeVisible();
        // Default sensitivity is 0.5, rendered as slider percent 50.
        await expect(slider).toHaveAttribute('aria-valuenow', '50');

        await slider.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(300);

        await expect(slider).toHaveAttribute('aria-valuenow', '51');
    });
});
