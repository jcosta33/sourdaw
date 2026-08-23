import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * E2E coverage gap: the BrowserAi module renders ModelManagerPanel and
 * CapabilityReportPanel inside the Preferences → AI section, but no spec
 * asserted a state change on either. Previous coverage only clicked the
 * unrelated "Load AI" button (the hosted-LLM loader) and re-asserted it was
 * visible, or counted buttons in the Generate panel.
 *
 * This spec asserts a real, in-browser state transition on ModelManagerPanel.
 * The assertion is chosen for determinism in Playwright's headless Chromium:
 * it does not depend on WebGPU, a model download completing, or any network
 * result. Clicking a model's Download button runs `downloadModel`, whose
 * repository calls `updateModelStatus(modelId, { status: 'downloading', ... })`
 * synchronously — before any `fetch`. The store flip re-renders the row from a
 * Download button into a progress bar, observable as an `aria-label` that did
 * not exist before the click.
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
        await expect(page.getByRole('dialog').getByText(/AI execution backend/i).first()).toBeVisible();
    });

    test('clicking Download moves the Kokoro model row from a download button to a progress bar', async ({
        page,
    }) => {
        // Initial state: on a fresh project OPFS is empty, so initBrowserAi
        // resolves the Kokoro model to 'not-downloaded' and the row renders a
        // Download button. No progress bar exists yet.
        const downloadButton = page.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ });
        await expect(downloadButton).toBeVisible();
        await expect(
            page.getByRole('progressbar', { name: /Downloading Kokoro-82M \(q8f16\):/ })
        ).toHaveCount(0);

        // State change: the click drives downloadModel → updateModelStatus(
        // { status: 'downloading', downloadProgress: 0 }) synchronously, before
        // any network I/O. The store flip re-renders the row as a progress bar.
        await downloadButton.click();

        // The download button is replaced by a progress bar labelled with the
        // model name and a percentage. This element was absent before the click
        // — a genuine state transition, observed via its accessible name.
        const progressBar = page.getByRole('progressbar', {
            name: /Downloading Kokoro-82M \(q8f16\):/,
        });
        await expect(progressBar).toBeVisible();
        // The store flip seeds downloadProgress at 0, so the initial readout is
        // 0%. Asserting the value (not just presence) ties the readout to the
        // 'downloading' state that the click produced.
        await expect(progressBar).toHaveAttribute('aria-valuenow', '0');
        await expect(page.getByText('0%', { exact: true })).toBeVisible();
    });

    test('CapabilityReportPanel surfaces a resolved capability verdict after boot detection', async ({
        page,
    }) => {
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
