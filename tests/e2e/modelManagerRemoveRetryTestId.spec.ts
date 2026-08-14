import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * E2E coverage gap: ModelManagerPanel's per-model Remove and Retry buttons
 * (ModelManagerPanel.tsx ModelAction) were never exercised — the only spec
 * touching the panel (browserAiPanelsTestId.spec.ts) clicks Download and
 * observes the synchronous 'downloading' store flip.
 *
 * Gating in ModelAction: status 'ready' renders "✓ Ready" + a Remove button
 * (aria-label "Remove <name> from storage"); status 'error' renders "Failed" +
 * a Retry button (aria-label "Retry downloading <name>"); anything else
 * renders a Download button. In a fresh profile OPFS is empty, so both
 * ModelAction rows (Kokoro, NSF-HiFiGAN) start 'not-downloaded' and neither
 * Remove nor Retry exists yet.
 *
 * To reach the gated states deterministically the specs intercept the model
 * CDN fetches with Playwright routing — no real network, no WebGPU, no
 * multi-minute 86 MB download:
 *
 * - Remove: fulfill the Kokoro URL with a tiny stub body. The URL ends in
 *   .onnx and ModelAction passes no sha256, so the download manager streams
 *   the bytes straight to OPFS and flips the store to 'ready' — the Remove
 *   button mounts. Clicking it runs removeModel → deleteModel (a real OPFS
 *   removeEntry of the streamed file) → updateModelStatus('not-downloaded'),
 *   re-rendering the row as a Download button.
 *
 * - Retry: abort the NSF-HiFiGAN URL. The download manager retries 3 times
 *   (1s + 2s backoff), then flips the store to 'error' — the Failed badge and
 *   Retry button mount. Clicking Retry re-enters downloadModel, whose
 *   synchronous updateModelStatus('downloading', 0) swaps the row back to a
 *   0% progress bar.
 */

const KOKORO_DOWNLOAD_URL =
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8f16.onnx';
const NSF_HIFIGAN_DOWNLOAD_URL =
    'https://huggingface.co/jcosta33/vocoder-models/resolve/main/nsf-hifigan-44k/nsf_hifigan_44.1k_hop512_128bin_2024.02.onnx';

/** Open Preferences and navigate to the AI section, whose "Browser AI"
 *  FieldGroup hosts ModelManagerPanel. Waits on the section's unique first
 *  FieldGroup label so later assertions target mounted content, not a clicked
 *  nav button. Mirrors browserAiRedetectKokoroTestId.spec.ts's open path. */
async function open_preferences_ai_section(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByText('AI execution backend').first()).toBeVisible();
    await expect(dialog.getByLabel('AI Model Manager')).toBeVisible();
}

test.describe('BrowserAi ModelManagerPanel — per-model Remove / Retry actions', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_preferences_ai_section(page);
    });

    test('fresh profile: only Download buttons render — Remove and Retry are gated behind ready/error', async ({
        page,
    }) => {
        const dialog = page.getByRole('dialog');

        // Both downloadable models (Kokoro TTS, NSF-HiFiGAN vocoder) resolved
        // to 'not-downloaded' against the empty OPFS at boot, so each row
        // offers a Download button. formatBytes reports MiB units (86 MB →
        // "82.0 MB"), so match the name by prefix.
        await expect(dialog.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Download NSF-HiFiGAN 44\.1k/ })).toBeVisible();

        // Neither gated action exists in the fresh state: no model is 'ready'
        // (Remove) and none is 'error' (Retry). Asserting absence of the exact
        // aria-labels the buttons would carry pins this to the real gating.
        await expect(dialog.getByRole('button', { name: /Remove .+ from storage/ })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: /Retry downloading .+/ })).toHaveCount(0);

        // The remaining model families render status badges, not action
        // buttons: initBrowserAi seeds every DDSP instrument with status
        // 'error' (TF.js worker is a stub in this build), rendered as an
        // "Unavailable" badge with no Retry affordance, and no DiffSinger
        // voice pack is installed.
        const ddsp_badges = dialog.getByText('Unavailable', { exact: true });
        await expect(ddsp_badges.first()).toBeVisible();
        expect(await ddsp_badges.count()).toBeGreaterThanOrEqual(4);
        await expect(dialog.getByText('No voice packs installed.')).toBeVisible();
    });

    test('Remove: a stored model row flips from Ready+Remove back to Download after removal', async ({ page }) => {
        const dialog = page.getByRole('dialog');

        // Serve a stub body for the 86 MB Kokoro artifact. The .onnx URL with
        // no sha256 takes the streamed path: bytes go straight to OPFS, then
        // updateModelStatus('ready') — no integrity check or extraction.
        await page.route(KOKORO_DOWNLOAD_URL, (route) =>
            route.fulfill({ body: 'stub-kokoro-onnx-bytes' })
        );

        const download_button = dialog.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ });
        await download_button.click();

        // The row transitions through 'downloading' into 'ready': the Ready
        // badge and the Remove button mount, and the Download button is gone.
        const ready_badge = dialog.getByLabel('Kokoro-82M (q8f16) downloaded and ready');
        const remove_button = dialog.getByRole('button', { name: 'Remove Kokoro-82M (q8f16) from storage' });
        await expect(ready_badge).toBeVisible({ timeout: 15_000 });
        await expect(remove_button).toBeVisible();
        await expect(download_button).toHaveCount(0);

        // Clicking Remove runs removeModel → deleteModel (real OPFS removal of
        // the file the streamed download just wrote) → updateModelStatus(
        // 'not-downloaded'), so the row re-renders as a Download button and
        // both the Ready badge and the Remove button disappear.
        await remove_button.click();

        await expect(download_button).toBeVisible();
        await expect(ready_badge).toHaveCount(0);
        await expect(remove_button).toHaveCount(0);
    });

    test('Retry: a failed download shows Failed+Retry, and Retry re-enters the downloading state', async ({
        page,
    }) => {
        const dialog = page.getByRole('dialog');

        // Kill the vocoder fetch at the network layer. The download manager
        // retries 3 times (1s + 2s exponential backoff ≈ 3s total), then flips
        // the store to 'error'.
        await page.route(NSF_HIFIGAN_DOWNLOAD_URL, (route) => route.abort('failed'));

        await dialog.getByRole('button', { name: /Download NSF-HiFiGAN 44\.1k/ }).click();

        // Terminal error state: the Failed badge and Retry button mount, and
        // the Download button is gone.
        const failed_badge = dialog.getByLabel('NSF-HiFiGAN 44.1k download failed');
        const retry_button = dialog.getByRole('button', { name: 'Retry downloading NSF-HiFiGAN 44.1k' });
        await expect(failed_badge).toBeVisible({ timeout: 15_000 });
        await expect(retry_button).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Download NSF-HiFiGAN 44\.1k/ })).toHaveCount(0);

        // Clicking Retry re-runs downloadModel, whose synchronous
        // updateModelStatus('downloading', 0) — before any fetch — swaps the
        // Failed/Retry pair back to a 0% progress bar.
        await retry_button.click();

        const progress_bar = dialog.getByRole('progressbar', { name: /Downloading NSF-HiFiGAN 44\.1k:/ });
        await expect(progress_bar).toBeVisible();
        await expect(progress_bar).toHaveAttribute('aria-valuenow', '0');
        await expect(failed_badge).toHaveCount(0);
        await expect(retry_button).toHaveCount(0);
    });
});
