import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const RENDER_EVIDENCE_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/render-evidence.json');
const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed, trying Tauri fallback',
    'No available adapters.',
] as const;

type WavSummary = {
    audioFormat: number;
    bitsPerSample: number;
    channels: number;
    dataBytes: number;
    durationSeconds: number;
    samplePeak: number;
    sampleRate: number;
};

function inspectPcmWav(bytes: Buffer): WavSummary {
    if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Downloaded file is not a complete RIFF/WAVE container');
    }

    let audioFormat = 0;
    let bitsPerSample = 0;
    let channels = 0;
    let dataBytes = 0;
    let dataOffset = 0;
    let sampleRate = 0;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const chunkId = bytes.toString('ascii', offset, offset + 4);
        const chunkSize = bytes.readUInt32LE(offset + 4);
        const chunkDataOffset = offset + 8;
        const chunkEnd = chunkDataOffset + chunkSize;
        if (chunkEnd > bytes.length) {
            throw new Error(`Truncated ${chunkId} chunk`);
        }
        if (chunkId === 'fmt ') {
            if (chunkSize < 16) {
                throw new Error('Invalid WAV format chunk');
            }
            audioFormat = bytes.readUInt16LE(chunkDataOffset);
            channels = bytes.readUInt16LE(chunkDataOffset + 2);
            sampleRate = bytes.readUInt32LE(chunkDataOffset + 4);
            bitsPerSample = bytes.readUInt16LE(chunkDataOffset + 14);
        }
        if (chunkId === 'data') {
            dataBytes = chunkSize;
            dataOffset = chunkDataOffset;
        }
        offset = chunkEnd + (chunkSize % 2);
    }

    if (audioFormat !== 1 || channels === 0 || sampleRate === 0 || bitsPerSample !== 24 || dataBytes === 0) {
        throw new Error('Downloaded WAV is missing supported PCM format or audio data');
    }
    const bytesPerSample = bitsPerSample / 8;
    const frameBytes = channels * bytesPerSample;
    if (dataBytes % frameBytes !== 0) {
        throw new Error('Downloaded WAV data does not end on a complete sample frame');
    }

    let samplePeak = 0;
    for (let sampleOffset = dataOffset; sampleOffset < dataOffset + dataBytes; sampleOffset += bytesPerSample) {
        let sample = bytes[sampleOffset]! | (bytes[sampleOffset + 1]! << 8) | (bytes[sampleOffset + 2]! << 16);
        if ((sample & 0x80_0000) !== 0) {
            sample -= 0x100_0000;
        }
        samplePeak = Math.max(samplePeak, Math.abs(sample) / 0x80_0000);
    }

    return {
        audioFormat,
        bitsPerSample,
        channels,
        dataBytes,
        durationSeconds: dataBytes / (sampleRate * frameBytes),
        samplePeak,
        sampleRate,
    };
}

test('exports the complete Mycelium Ascendant mix as a stereo WAV', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new TypeError('Mycelium export E2E requires a configured Playwright baseURL');
    }
    const appOrigin = new URL(configuredBaseUrl).origin;
    const consoleErrors: string[] = [];
    const unexpectedWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const externalRequests: string[] = [];
    const httpErrors: string[] = [];

    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            consoleErrors.push(text);
        }
        if (message.type() === 'warning' && !ALLOWED_WARNING_FRAGMENTS.some((fragment) => text.includes(fragment))) {
            unexpectedWarnings.push(text);
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown request failure';
        if (failure === 'net::ERR_ABORTED') {
            return;
        }
        failedRequests.push(`${failure} ${request.method()} ${request.url()}`);
    });
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== appOrigin) {
            externalRequests.push(`${request.method()} ${request.url()}`);
        }
    });
    page.on('response', (response) => {
        if (response.status() >= 400) {
            httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        }
    });
    await page.addInitScript(() => {
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
    await setupWorkspace(page);

    const launchScreen = page.getByLabel('Sourdaw — start a project');
    await expect(launchScreen).toBeVisible();
    await page.locator('#launch-demo-project').click();
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible();
    await card.click();
    await wait_for_workspace_ready(page);
    await expect(page.getByRole('button', { name: 'Mycelium Ascendant' })).toBeVisible();

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /WAV/i })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('checkbox', { name: /MP3/i })).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByRole('checkbox', { name: /FLAC/i })).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByRole('radio', { name: 'Whole project' })).toBeChecked();
    await expect(dialog.getByLabel('Tail seconds')).toHaveValue('2');
    await dialog.getByRole('button', { name: 'Repeatable', exact: true }).click();

    const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
    await dialog.getByRole('button', { name: 'Start Baking' }).click();
    const download = await downloadPromise;
    await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible({ timeout: 300_000 });

    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
    const downloadPath = await download.path();
    if (!downloadPath) {
        throw new Error('Playwright did not retain the downloaded WAV');
    }
    const wavBytes = await readFile(downloadPath);
    const wav = inspectPcmWav(wavBytes);
    const evidence = JSON.parse(await readFile(RENDER_EVIDENCE_PATH, 'utf8')) as { wavSha256: string };
    expect(wav.audioFormat).toBe(1);
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(44_100);
    expect(wav.bitsPerSample).toBe(24);
    expect(wav.dataBytes).toBeGreaterThan(60_000_000);
    expect(wav.durationSeconds).toBeGreaterThan(240);
    expect(wav.durationSeconds).toBeLessThan(242);
    expect(wav.samplePeak).toBeGreaterThan(0.1);
    expect(wav.samplePeak).toBeLessThan(1);
    const wavSha256 = createHash('sha256').update(wavBytes).digest('hex');
    expect(wavSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.wavSha256).toMatch(/^[0-9a-f]{64}$/);
    await testInfo.attach('mycelium-wav-evidence', {
        body: JSON.stringify({ capturedAt: new Date().toISOString(), wavSha256, ...wav }),
        contentType: 'application/json',
    });
    expect(consoleErrors).toEqual([]);
    expect(unexpectedWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(httpErrors).toEqual([]);
});
