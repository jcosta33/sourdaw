import { test, expect } from '@playwright/test';

import { launch_new_project, setupWebGpuApiPresentWorkspace, setupWorkspace } from './e2eUtils';

// The LlmStatusBadge's model-onboarding affordances have no E2E: the download
// button's per-model label and the verification blurb are the first AI touch
// for browser users. This test establishes only the WebGPU API-present UI
// precondition and asserts the pre-download onboarding interface; it does not
// assert a usable adapter, runtime capability, provider admission, or download.
test.describe('LlmStatusBadge — model download affordances', () => {
    test('withholds download affordances when the WebGPU API is unavailable', async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        const unavailable = page.getByText('AI unavailable', { exact: true });
        await expect(unavailable).toBeVisible();
        await expect(unavailable).toHaveAttribute('title', 'No configured AI backend is available');
        await expect(page.getByRole('button', { name: 'Load AI', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Download & Load /i })).toHaveCount(0);

        await page.getByTestId('toggle-preferences').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'AI', exact: true }).click();
        await expect(
            dialog.getByText(
                'Automatic uses WebLLM in this browser only. Select a hosted provider explicitly to send prompts remotely.'
            )
        ).toBeVisible();
    });

    test('shows model onboarding and download affordances when the WebGPU API is present', async ({ page }) => {
        test.setTimeout(120000);
        await setupWebGpuApiPresentWorkspace(page);
        await launch_new_project(page);

        await page.getByRole('button', { name: 'Load AI' }).first().click();

        // Model options are DawChooserCard buttons named "<display> <description>
        // <params> <sizes>" (the display name is a card heading, not a title
        // attribute); each card carries its download size in GB.
        const cards = page.getByRole('button').filter({ hasText: /GB/ });
        await expect(cards.nth(0)).toBeVisible({ timeout: 10_000 });
        expect(await cards.count()).toBeGreaterThan(1);

        // Selecting a card changes the download button's label to that
        // model's display name (Light/Standard/Pro) — the label is the
        // per-model contract. The default selection is Standard, so the
        // pre-state is asserted before any click; Pro and Light then prove
        // the retitling is selection-driven.
        const downloadButton = page.getByRole('button', { name: /Download & Load /i });
        await expect(downloadButton).toHaveText(/Download & Load Standard/);

        await cards.filter({ hasText: 'Pro' }).first().click();
        await expect(downloadButton).toHaveText(/Download & Load Pro/);

        await cards.filter({ hasText: 'Light' }).first().click();
        await expect(downloadButton).toHaveText(/Download & Load Light/);

        // The privacy blurb states the download-and-verify behavior.
        await expect(page.getByText(/Downloads and verifies this model/i)).toBeVisible();
    });
});
