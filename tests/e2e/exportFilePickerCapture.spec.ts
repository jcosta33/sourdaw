import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installFilePickerCapture, type FilePickerCapture } from './exportFilePickerCapture';

type ByteChunks = [number[], number[]];

function captureFixtureUrl(observePickerOwnership = false): string {
    const ownershipObserver = observePickerOwnership
        ? "document.documentElement.dataset.pickerOwnedAtLoad = String(Object.hasOwn(window, 'showSaveFilePicker'));"
        : '';
    const html = `<!doctype html>
<html>
    <body>
        <button id="export" type="button">Export exact bytes</button>
        <script>
            ${ownershipObserver}
            const button = document.getElementById('export');
            if (!button) throw new Error('Export fixture button is missing');
            button.addEventListener('click', async () => {
                document.body.dataset.exportStatus = 'pending';
                try {
                    const chunks = Reflect.get(window, '__captureChunks');
                    const file = await window.showSaveFilePicker({ suggestedName: 'capture.wav' });
                    const writable = await file.createWritable();
                    await writable.write(new Uint8Array(chunks[0]));
                    await writable.write(new Uint8Array(chunks[1]));
                    await writable.close();
                    document.body.dataset.exportStatus = 'complete';
                } catch (error) {
                    document.body.dataset.exportStatus = error instanceof Error ? error.message : 'unknown error';
                }
            });
        </script>
    </body>
</html>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function expectCapturedBytes(page: Page, capture: FilePickerCapture, chunks: ByteChunks): Promise<void> {
    await page.evaluate((writes) => {
        Reflect.set(window, '__captureChunks', writes);
    }, chunks);
    await page.getByRole('button', { name: 'Export exact bytes' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-export-status', 'complete', { timeout: 10_000 });
    await capture.waitForClose();

    expect(await capture.pickerFilename).toBe('capture.wav');
    expect(capture.writeCount()).toBe(2);
    expect(capture.bytesWritten()).toBeGreaterThan(0);
    expect(capture.abortCount()).toBe(0);
    expect(await readFile(capture.path)).toEqual(Buffer.from(chunks.flat()));
}

function pickerDescriptor(page: Page) {
    return page.evaluate(() => {
        const priorPicker = async (): Promise<string> => 'prior-picker';
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: priorPicker,
        });
        Reflect.set(window, '__expectedPriorPicker', priorPicker);
        const descriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
        return {
            configurable: descriptor?.configurable,
            enumerable: descriptor?.enumerable,
            writable: descriptor?.writable,
            hasExpectedValue: descriptor?.value === priorPicker,
        };
    });
}

async function expectPriorPickerRestored(
    page: Page,
    expected: Awaited<ReturnType<typeof pickerDescriptor>>
): Promise<void> {
    const restored = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
        return {
            configurable: descriptor?.configurable,
            enumerable: descriptor?.enumerable,
            writable: descriptor?.writable,
            hasExpectedValue: descriptor?.value === Reflect.get(window, '__expectedPriorPicker'),
        };
    });
    expect(restored).toEqual(expected);
}

function outputFile(testInfo: TestInfo, label: string): string {
    return testInfo.outputPath(`${label}-${randomUUID()}.wav`);
}

test('captures picker streams before navigation and across fresh exports', async ({ page }, testInfo) => {
    const beforeNavigation = await installFilePickerCapture(page, outputFile(testInfo, 'before-navigation'));
    try {
        await page.goto(captureFixtureUrl());
        await expectCapturedBytes(page, beforeNavigation, [
            [0, 255],
            [23, 42],
        ]);
    } finally {
        await beforeNavigation.dispose();
    }

    await page.goto(captureFixtureUrl(true));
    await expect(page.locator('html')).toHaveAttribute('data-picker-owned-at-load', 'false');
    const previousPicker = await pickerDescriptor(page);

    const firstLoadedCapture = await installFilePickerCapture(page, outputFile(testInfo, 'loaded-first'));
    try {
        await expectCapturedBytes(page, firstLoadedCapture, [
            [9, 8],
            [7, 6, 5],
        ]);
    } finally {
        await firstLoadedCapture.dispose();
    }
    await expectPriorPickerRestored(page, previousPicker);

    const secondLoadedCapture = await installFilePickerCapture(page, outputFile(testInfo, 'loaded-second'));
    try {
        await expectCapturedBytes(page, secondLoadedCapture, [
            [32, 33, 34],
            [35, 36, 37],
        ]);
    } finally {
        await secondLoadedCapture.dispose();
    }
    await expectPriorPickerRestored(page, previousPicker);

    await page.goto(captureFixtureUrl(true));
    await expect(page.locator('html')).toHaveAttribute('data-picker-owned-at-load', 'false');
});
