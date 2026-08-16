import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// The LlmStatusBadge's model-onboarding affordances (#1954 WebLLM artifact
// admission) have no E2E: the download button's per-model label and the
// verification blurb are the first AI touch for browser users. The button
// renders pre-download, reachable without WebGPU completing, so the panel
// contract is assertable without downloading anything.
test.describe('LlmStatusBadge — model download affordances', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('the panel offers model choice, a named download button, and the verification blurb', async ({ page }) => {
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
