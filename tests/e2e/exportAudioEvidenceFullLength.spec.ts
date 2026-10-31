import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { analyzePcmWav } from './analyzePcmWav';
import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';
import { expectNebulaMixQuality, watchExportRun } from './exportAudioEvidenceHarness';
import { installFilePickerCapture } from './exportFilePickerCapture';

// #5960: the whole 301 s project renders in minutes on one Web Audio offline thread, far past what
// a PR browser shard should pay. exportAudioEvidence.spec.ts proves the same quality bounds on a
// 30 s loop region there; this file keeps the full-length proof on the nightly and local runs,
// which never set CI together with E2E_SPECS.
test.skip(
    isBuiltE2eShardRun(process.env),
    '#5960: the full-length Nebula Drift export proof runs nightly and locally, not on PR browser shards'
);

const EXPORT_COMPLETION_TIMEOUT_MS = 900_000;

test('exports the complete Nebula Drift mix as a stereo WAV', async ({ page }, testInfo) => {
    test.setTimeout(EXPORT_COMPLETION_TIMEOUT_MS + 60_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new TypeError('Audio export E2E requires a configured Playwright baseURL');
    }
    const findings = watchExportRun(page, new URL(configuredBaseUrl).origin);
    const capture = await installFilePickerCapture(page, testInfo.outputPath('nebula-drift-mix.wav'));
    try {
        await setupWorkspace(page);

        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await expect(launchScreen).toBeVisible({ timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS });
        await page.locator('#launch-demo-project').click();
        const card = page.getByRole('button', { name: /Nebula Drift/i });
        await expect(card).toBeVisible();
        await card.click();
        await wait_for_workspace_ready(page);
        await expect(page.getByRole('button', { name: 'Nebula Drift' })).toBeVisible();

        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
        await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('checkbox', { name: /WAV/i })).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.getByRole('checkbox', { name: 'MP3 Lossy crust', exact: true })).toHaveAttribute(
            'aria-checked',
            'false'
        );
        await expect(dialog.getByRole('checkbox', { name: /FLAC/i })).toHaveAttribute('aria-checked', 'false');
        await expect(dialog.getByRole('radio', { name: 'Whole project' })).toBeChecked();
        // Auto-detect tail defaults on, so the manual Tail-seconds field is disabled
        // and empty until it is toggled off. Toggling exposes the default (2s).
        const autoTail = dialog.getByLabel('Auto-detect');
        await expect(autoTail).toBeChecked();
        const tailInput = dialog.getByLabel('Tail seconds');
        await expect(tailInput).toBeDisabled();
        await expect(tailInput).toHaveValue('');
        await autoTail.uncheck();
        await expect(tailInput).toBeEnabled();
        await expect(tailInput).toHaveValue('2');

        const pickerFilename = capture.pickerFilename;
        await dialog.getByRole('button', { name: 'Start Baking' }).click();
        await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible({
            timeout: EXPORT_COMPLETION_TIMEOUT_MS,
        });
        await capture.waitForClose();

        expect(await pickerFilename).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
        expect(capture.writeCount()).toBeGreaterThan(0);
        expect(capture.bytesWritten()).toBeGreaterThan(78_000_000);
        expect(capture.abortCount()).toBe(0);
        const wavBytes = await readFile(capture.path);
        const wav = analyzePcmWav(wavBytes);
        expect(wav.dataBytes).toBeGreaterThan(78_000_000);
        expect(wav.durationSeconds).toBeGreaterThan(298);
        expect(wav.durationSeconds).toBeLessThan(303);
        expectNebulaMixQuality(wav);
        const wavSha256 = createHash('sha256').update(wavBytes).digest('hex');
        expect(wavSha256).toMatch(/^[0-9a-f]{64}$/);
        await testInfo.attach('nebula-drift-wav-evidence', {
            body: JSON.stringify({ capturedAt: new Date().toISOString(), wavSha256, ...wav }),
            contentType: 'application/json',
        });
        await testInfo.attach('nebula-drift-stereo-wav', {
            path: capture.path,
            contentType: 'audio/wav',
        });
        findings.expectClean();
    } finally {
        if (!page.isClosed()) {
            await page.close();
        }
        await capture.dispose();
    }
});
