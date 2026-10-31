import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { analyzePcmWav } from './analyzePcmWav';
import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';
import {
    expectNebulaMixQuality,
    MANUAL_TAIL_SECONDS,
    watchExportRun,
    WAV_BYTES_PER_SECOND,
} from './exportAudioEvidenceHarness';
import { installFilePickerCapture } from './exportFilePickerCapture';

// #5960: the browser OfflineAudioContext renders on one CPU-bound thread at roughly 1.5x realtime
// locally and 0.5x on a CI runner, so a 30 s loop region keeps PR shards short while still
// rendering the opening through its tracks and buses. exportAudioEvidenceFullLength.spec.ts
// holds the whole-project proof for nightly and local runs. The budget covers a ~60 s render on a
// runner about three times slower than a development machine, with headroom for first-paint load.
const EXPORT_COMPLETION_TIMEOUT_MS = 300_000;

// A bounded render starts at timeline zero so stateful devices hear the same history as a full
// playthrough (resolveHistoryAwareRenderContext), so a loop starting later pays for its whole
// lead-in. Beats 0-39 are the demo's opening, which keeps the render at the loop's own length. The
// ruler floors the drag start and ceils its end to whole beats.
const LOOP_START_BEAT = 0;
const LOOP_END_BEAT = 39;
// The demo holds 76 BPM until its first tempo change at beat 148, past the loop's end.
const DEMO_BPM = 76;
const LOOP_SECONDS = ((LOOP_END_BEAT - LOOP_START_BEAT) * 60) / DEMO_BPM;
const DURATION_TOLERANCE_SECONDS = 1;
// Share of the loop's own bytes the written data must reach; the tail only adds to it.
const BYTE_FLOOR_RATIO = 0.95;
// "Zoom to fit" leaves the 1280 px viewport at two pixels per beat, so these x offsets inside the
// beat ruler land at beats 0.5 and 38.5. The loop label asserted below fails loudly if the zoom
// ever changes.
const PIXELS_PER_BEAT_AFTER_FIT = 2;
const DRAG_START_X = (LOOP_START_BEAT + 0.5) * PIXELS_PER_BEAT_AFTER_FIT;
const DRAG_END_X = (LOOP_END_BEAT - 0.5) * PIXELS_PER_BEAT_AFTER_FIT;

async function setLoopRegionOnRuler(page: Page): Promise<void> {
    const ruler = page.getByLabel('Beat ruler');
    await expect(ruler).toBeVisible();
    const unzoomed = await ruler.screenshot();
    await page.keyboard.press('f');
    await expect.poll(async () => (await ruler.screenshot()).equals(unzoomed)).toBe(false);

    const box = await ruler.boundingBox();
    if (box === null) {
        throw new Error('Beat ruler has no bounding box');
    }
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + DRAG_START_X, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(box.x + DRAG_END_X, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
}

test('exports a 30 s loop region of the Nebula Drift mix as a stereo WAV', async ({ page }, testInfo) => {
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

        await setLoopRegionOnRuler(page);

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
        const loopRegion = dialog.getByRole('radio', {
            name: `Loop region (beat ${LOOP_START_BEAT}.00 → ${LOOP_END_BEAT}.00)`,
            exact: true,
        });
        await expect(loopRegion).toBeEnabled();
        await loopRegion.check();
        await expect(loopRegion).toBeChecked();
        await expect(dialog.getByRole('radio', { name: 'Whole project' })).not.toBeChecked();
        // Auto-detect tail defaults on, so the manual Tail-seconds field is disabled
        // and empty until it is toggled off. Toggling exposes the default (2s).
        const autoTail = dialog.getByLabel('Auto-detect');
        await expect(autoTail).toBeChecked();
        const tailInput = dialog.getByLabel('Tail seconds');
        await expect(tailInput).toBeDisabled();
        await expect(tailInput).toHaveValue('');
        await autoTail.uncheck();
        await expect(tailInput).toBeEnabled();
        await expect(tailInput).toHaveValue(String(MANUAL_TAIL_SECONDS));

        const byteFloor = LOOP_SECONDS * WAV_BYTES_PER_SECOND * BYTE_FLOOR_RATIO;
        const pickerFilename = capture.pickerFilename;
        await dialog.getByRole('button', { name: 'Start Baking' }).click();
        // A failed bake leaves the dialog without a Close Bakery button, so wait on either ending
        // and fail at once on the refusal instead of burning the whole budget.
        const closeBakery = dialog.getByRole('button', { name: 'Close Bakery' });
        const refusal = dialog.getByText(/The bread burned/);
        await expect
            .poll(async () => (await closeBakery.isVisible()) || (await refusal.isVisible()), {
                timeout: EXPORT_COMPLETION_TIMEOUT_MS,
            })
            .toBe(true);
        await expect(refusal).toBeHidden();
        await expect(closeBakery).toBeVisible();
        await capture.waitForClose();

        expect(await pickerFilename).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
        expect(capture.writeCount()).toBeGreaterThan(0);
        expect(capture.bytesWritten()).toBeGreaterThan(byteFloor);
        expect(capture.abortCount()).toBe(0);
        const wavBytes = await readFile(capture.path);
        const wav = analyzePcmWav(wavBytes);
        expect(wav.dataBytes).toBeGreaterThan(byteFloor);
        expect(wav.durationSeconds).toBeGreaterThan(LOOP_SECONDS + MANUAL_TAIL_SECONDS - DURATION_TOLERANCE_SECONDS);
        expect(wav.durationSeconds).toBeLessThan(LOOP_SECONDS + MANUAL_TAIL_SECONDS + DURATION_TOLERANCE_SECONDS);
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
