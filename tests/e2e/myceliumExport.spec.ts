import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { analyzePcmWav } from './analyzePcmWav';
import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed, trying Tauri fallback',
    'No available adapters.',
] as const;

test('exports the complete Mycelium Ascendant mix as a stereo WAV', async ({ page }, testInfo) => {
    test.setTimeout(600_000);
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
    const wav = analyzePcmWav(wavBytes);
    expect(wav.audioFormat).toBe(1);
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(44_100);
    expect(wav.bitsPerSample).toBe(24);
    expect(wav.dataBytes).toBeGreaterThan(60_000_000);
    expect(wav.durationSeconds).toBeGreaterThan(240);
    expect(wav.durationSeconds).toBeLessThan(242);
    expect(wav.samplePeak).toBeGreaterThan(0.1);
    expect(wav.samplePeak).toBeLessThan(0.9);
    expect(wav.clippedSampleCount).toBe(0);
    expect(wav.integratedLufs).toBeGreaterThanOrEqual(-11);
    expect(wav.integratedLufs).toBeLessThanOrEqual(-8);
    expect(wav.truePeakDbTp).toBeLessThanOrEqual(-0.8);
    expect(Math.max(...wav.dcOffsets.map(Math.abs))).toBeLessThan(0.005);
    expect(wav.lowMonoCompatibilityDb).toBeGreaterThan(-3);
    expect(wav.lowCorrelation).toBeGreaterThan(0);
    expect(wav.activeBlockRatio).toBeGreaterThan(0.5);
    const wavSha256 = createHash('sha256').update(wavBytes).digest('hex');
    expect(wavSha256).toMatch(/^[0-9a-f]{64}$/);
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
