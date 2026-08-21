import { expect, test, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

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

function audioHeaderRow(page: Page): Locator {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .filter({ has: page.getByText('Audio', { exact: true }) })
        .filter({ hasNot: page.getByRole('button', { name: 'Add take' }) });
}

async function addAudioTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add Audio Track');
    await page.getByRole('option', { name: 'Add Audio Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
    await audioHeaderRow(page).getByText('Audio', { exact: true }).click();
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function importToneClip(page: Page): Promise<void> {
    await audioHeaderRow(page).getByText('Audio', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /Import Audio/i })).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (
        await chooser
    ).setFiles({
        name: 'tone.wav',
        mimeType: 'audio/wav',
        buffer: buildSineWav(),
    });

    await openBottomTab(page, 'Editor');
    await expect(page.getByTestId('selected-track-clip-count')).toHaveText('1 clip');
}

async function clipLaneY(page: Page): Promise<number> {
    const canvas = page.getByLabel('Timeline editor surface');
    const muteBox = await page.getByRole('button', { name: 'Mute Audio' }).boundingBox();
    const canvasBox = await canvas.boundingBox();
    if (!muteBox || !canvasBox) {
        throw new Error('Mute Audio or timeline surface has no bounding box');
    }
    return muteBox.y - canvasBox.y + muteBox.height / 2;
}

test.describe('Undo/redo of clip split', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addAudioTrack(page);
        await importToneClip(page);
    });

    test('split → undo restores one clip → redo re-splits to two', async ({ page }) => {
        const clipCount = page.getByTestId('selected-track-clip-count');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        const canvas = page.getByLabel('Timeline editor surface');
        const y = await clipLaneY(page);

        await expect(clipCount).toHaveText('1 clip');

        await canvas.click({ button: 'right', position: { x: 60, y } });
        await page.getByRole('menuitem', { name: 'Split at Cursor' }).click();

        await expect(clipCount).toHaveText('2 clips');
        await expect(undo).toBeEnabled();
        await expect(redo).toBeDisabled();

        await undo.click();

        await expect(clipCount).toHaveText('1 clip');
        await expect(redo).toBeEnabled();

        await redo.click();

        await expect(clipCount).toHaveText('2 clips');
    });
});
