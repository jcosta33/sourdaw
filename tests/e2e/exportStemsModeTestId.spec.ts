import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

import { launch_from_template, setupWorkspace } from './e2eUtils';
import { installFilePickerCapture } from './exportFilePickerCapture';

async function openBakery(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

function inspectStemWav(bytes: Uint8Array): { channels: number; durationSeconds: number; sampleRate: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readTag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (
        bytes.length < 44 ||
        readTag(0) !== 'RIFF' ||
        view.getUint32(4, true) !== bytes.byteLength - 8 ||
        readTag(8) !== 'WAVE'
    ) {
        throw new Error('A captured stem is not a complete RIFF/WAVE file.');
    }

    let audioFormat: number | undefined;
    let channels: number | undefined;
    let sampleRate: number | undefined;
    let bitsPerSample: number | undefined;
    let dataBytes: number | undefined;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
        const chunkName = readTag(offset);
        const chunkSize = view.getUint32(offset + 4, true);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkSize;
        if (chunkEnd > bytes.byteLength) {
            throw new Error(`Captured stem has a truncated ${chunkName} chunk.`);
        }
        if (chunkName === 'fmt ') {
            if (chunkSize < 16) {
                throw new Error('Captured stem has an invalid WAV format chunk.');
            }
            audioFormat = view.getUint16(chunkStart, true);
            channels = view.getUint16(chunkStart + 2, true);
            sampleRate = view.getUint32(chunkStart + 4, true);
            bitsPerSample = view.getUint16(chunkStart + 14, true);
        }
        if (chunkName === 'data') {
            dataBytes = chunkSize;
        }
        offset = chunkEnd + (chunkSize % 2);
    }
    if (
        audioFormat !== 1 ||
        channels === undefined ||
        channels === 0 ||
        sampleRate === undefined ||
        sampleRate === 0 ||
        bitsPerSample !== 24 ||
        dataBytes === undefined ||
        dataBytes === 0 ||
        dataBytes % (channels * (bitsPerSample / 8)) !== 0
    ) {
        throw new Error('Captured stem has no complete 24-bit PCM sample frames.');
    }
    return {
        channels,
        durationSeconds: dataBytes / (channels * (bitsPerSample / 8) * sampleRate),
        sampleRate,
    };
}

test.describe('Export stems mode', () => {
    test('stems mode is mutually exclusive with mixdown', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openBakery(page);

        const mixdown = page.getByTestId('export-mode-mixdown');
        const stems = page.getByTestId('export-mode-stems');

        // Mixdown is the default active mode; stems starts inactive (outline).
        await expect(mixdown).not.toHaveAttribute('data-variant', 'outline');
        await expect(stems).toHaveAttribute('data-variant', 'outline');

        await stems.click();

        // The existing fidelity suite only proves the stems button itself changed
        // variant; this proves the mode group is a single-choice toggle — mixdown
        // deactivates when stems becomes active.
        await expect(stems).not.toHaveAttribute('data-variant', 'outline');
        await expect(mixdown).toHaveAttribute('data-variant', 'outline');
    });

    test('stems mode bakes a multi-stem ZIP instead of a single mixdown file', async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        const capture = await installFilePickerCapture(page, testInfo.outputPath('sourdaw-stems-export.zip'));
        try {
            await setupWorkspace(page);
            await launch_from_template({ page, template_name: /EDM/i });

            await openBakery(page);
            const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });

            await dialog.getByTestId('export-mode-stems').click();
            await expect(dialog.getByTestId('export-mode-stems')).not.toHaveAttribute('data-variant', 'outline');

            const pickerFilename = capture.pickerFilename;
            await dialog.getByRole('button', { name: 'Start Baking' }).click();
            await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible({ timeout: 220_000 });
            await capture.waitForClose();

            expect(await pickerFilename).toMatch(/^Sourdaw_Bake_\d+\.zip$/);
            expect(capture.writeCount()).toBeGreaterThan(0);
            expect(capture.bytesWritten()).toBeGreaterThan(0);
            expect(capture.abortCount()).toBe(0);

            const entries = unzipSync(await readFile(capture.path));
            await testInfo.attach('sourdaw-stems-archive', { path: capture.path, contentType: 'application/zip' });
            const wavEntries = Object.entries(entries).filter(([name]) => name.toLowerCase().endsWith('.wav'));
            expect(wavEntries.length).toBeGreaterThan(1);
            expect(new Set(wavEntries.map(([name]) => name)).size).toBe(wavEntries.length);
            for (const [name, bytes] of wavEntries) {
                expect(name).toMatch(/\.wav$/i);
                const wav = inspectStemWav(bytes);
                expect(wav.channels).toBe(2);
                expect(wav.sampleRate).toBe(44_100);
                expect(wav.durationSeconds).toBeGreaterThan(0);
            }
        } finally {
            if (!page.isClosed()) {
                await page.close();
            }
            await capture.dispose();
        }
    });

    test('explains that browser file storage is unavailable when the picker is missing', async ({ page }) => {
        await page.addInitScript(() => {
            let owner: object | null = window;
            while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, 'showSaveFilePicker')) {
                owner = Object.getPrototypeOf(owner) as object | null;
            }
            if (owner !== null && !Reflect.deleteProperty(owner, 'showSaveFilePicker')) {
                throw new Error('Unable to remove showSaveFilePicker for missing-storage E2E coverage');
            }
            if ('showSaveFilePicker' in window) {
                throw new Error('showSaveFilePicker remains present after test setup');
            }
        });
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openBakery(page);

        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await dialog.getByRole('button', { name: 'Start Baking' }).click();
        await expect(
            dialog.getByText(/Streaming export needs a browser with the Save File picker and writable file storage\./i)
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toHaveCount(0);
    });
});
