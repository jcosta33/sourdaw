import { expect, test, type Page } from '@playwright/test';

import { KOKORO_MODEL_ARTIFACT } from '../../src/modules/BrowserAi/models/KokoroArtifactManifest';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const KOKORO_DOWNLOAD_URL = KOKORO_MODEL_ARTIFACT.url;

/**
 * E2E coverage gap: the BrowserAi module renders ModelManagerPanel and
 * CapabilityReportPanel inside the Preferences → AI section, but no spec
 * asserted a state change on either. Previous coverage only clicked the
 * unrelated "Load AI" button (the hosted-LLM loader) and re-asserted it was
 * visible, or counted buttons in the Generate panel.
 *
 * This spec asserts a real, in-browser state transition on ModelManagerPanel.
 * The Kokoro artifact URL is routed and aborted (the modelManagerAdmission
 * pattern), so the click's fetch fails deterministically and no request
 * leaves the runner. The row settles in the terminal 'error' state — a
 * download-failed badge plus a Retry button, with the progress bar unmounted —
 * which is what the assertions read; nothing here depends on WebGPU or on
 * how long the transient 'downloading' state stays on screen.
 */

async function openPreferences(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
}

async function navToAi(page: Page): Promise<void> {
    // The section nav buttons live in the preferences dialog sidebar.
    await page.getByRole('dialog').getByRole('button', { name: 'AI', exact: true }).click();
}

test.describe('BrowserAi panels — ModelManagerPanel state change', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPreferences(page);
        await navToAi(page);
        // The AI section's first FieldGroup label mounts when the section body
        // swaps in, proving the BrowserAi panels are rendered — not just that a
        // nav button was clicked.
        await expect(
            page
                .getByRole('dialog')
                .getByText(/AI execution backend/i)
                .first()
        ).toBeVisible();
    });

    test('clicking Download moves the Kokoro model row to the download-failed retry state', async ({ page }) => {
        // Initial state: on a fresh project OPFS is empty, so initBrowserAi
        // resolves the Kokoro model to 'not-downloaded' and the row renders a
        // Download button. No progress bar or failure surface exists yet.
        const downloadButton = page.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ });
        await expect(downloadButton).toBeVisible();
        await expect(page.getByRole('progressbar', { name: /Downloading Kokoro-82M \(q8f16\):/ })).toHaveCount(0);
        await expect(page.getByLabel('Kokoro-82M (q8f16) download failed')).toHaveCount(0);

        // Intercept the artifact URL so the click's fetch deterministically
        // fails instead of egressing to huggingface.co — the same route-abort
        // modelManagerAdmission installs for this URL.
        await page.route(KOKORO_DOWNLOAD_URL, (route) => route.abort('failed'));

        const page_errors: Error[] = [];
        page.on('pageerror', (error) => page_errors.push(error));

        // State change: the click drives downloadModel, whose fetch is aborted
        // by the route. After the download manager's bounded retries exhaust,
        // updateModelStatus lands the row in the 'error' state.
        await downloadButton.click();

        // The terminal aborted-path presentation, matching what
        // modelManagerAdmission asserts for the same route: the row shows a
        // download-failed badge and a Retry button. The 15s allowance covers
        // the download manager's three attempts and their backoff.
        const failedBadge = page.getByLabel('Kokoro-82M (q8f16) download failed');
        const retryButton = page.getByRole('button', { name: 'Retry downloading Kokoro-82M (q8f16)' });
        await expect(failedBadge).toBeVisible({ timeout: 15_000 });
        await expect(retryButton).toBeVisible();

        // The failed row no longer offers the download button or the in-flight
        // progress bar — both left with the states that preceded the failure.
        await expect(downloadButton).toHaveCount(0);
        await expect(page.getByRole('progressbar', { name: /Downloading Kokoro-82M \(q8f16\):/ })).toHaveCount(0);

        expect(page_errors).toHaveLength(0);

        // Retry follows the same bounded abort path and must settle back into
        // the terminal failure state without leaking a browser page error.
        await retryButton.click();
        await expect(page.getByRole('progressbar', { name: /Downloading Kokoro-82M \(q8f16\):/ })).toBeVisible();
        await expect(failedBadge).toBeVisible({ timeout: 15_000 });
        await expect(retryButton).toBeVisible();
        expect(page_errors).toHaveLength(0);
    });

    test('CapabilityReportPanel surfaces a resolved capability verdict after boot detection', async ({ page }) => {
        // initBrowserAi() runs at boot and calls setCapabilityReport(report), so
        // by the time the Preferences dialog opens the capability store has left
        // the idle 'No capabilities detected' state. The panel reflects one of
        // the resolved verdicts — proving the detection pipeline ran and the
        // panel renders the detected platform state rather than the idle
        // placeholder. Which verdict lands depends on the host (Playwright's
        // headless Chromium has a Chrome UA but typically no WebGPU), so the
        // assertion accepts any resolved terminal verdict and explicitly rejects
        // the idle 'No capabilities detected' placeholder.
        const dialog = page.getByRole('dialog');

        // The 'Browser AI' FieldGroup from AiSection hosts CapabilityReportPanel.
        const browserAiField = dialog.locator('label').filter({ hasText: 'Browser AI' });
        await expect(browserAiField).toBeVisible();

        const resolvedVerdict = dialog.getByText(
            /Fast \(WebGPU\)|Slow \(WebGPU\)|Not Measured|Unavailable|Browser AI Unavailable/i
        );
        await expect(resolvedVerdict.first()).toBeVisible();

        // The idle placeholder must NOT be present: detection ran at boot and
        // moved the panel out of its initial state.
        await expect(dialog.getByText('No capabilities detected')).toHaveCount(0);
    });
});
