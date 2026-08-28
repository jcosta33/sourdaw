import { test, expect } from '@playwright/test';

import { probeBrowserWebGpuHardware } from './browserAiHardware';
import { launch_new_project, setupWorkspace } from './e2eUtils';

// The LlmStatusBadge is the first AI touch for browser users, and what it may
// offer is decided by WebGPU admission: model onboarding when a device is
// admitted, nothing to click when it is not. The expectation is read from
// Chromium's own adapter, outside Sourdaw's capability detection, so the badge
// cannot satisfy this spec by agreeing with its own report. Per-model labels
// have their own deterministic coverage in the LlmStatusBadge component spec.
test.describe('LlmStatusBadge — model download affordances', () => {
    test('offers model onboarding only when this browser admits a WebGPU device', async ({ page }, testInfo) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        const hardware = await probeBrowserWebGpuHardware(page);
        await testInfo.attach('webgpu-hardware-probe', {
            body: JSON.stringify(hardware),
            contentType: 'application/json',
        });

        if (hardware.status === 'unavailable') {
            const unavailable = page.getByText('AI unavailable', { exact: true });
            await expect(unavailable).toBeVisible();
            await expect(unavailable).toHaveAttribute('title', 'No configured AI backend is available');
            await expect(page.getByRole('button', { name: 'Load AI', exact: true })).toHaveCount(0);
            await expect(page.getByRole('button', { name: /Download & Load /i })).toHaveCount(0);
        } else {
            await page.getByRole('button', { name: 'Load AI', exact: true }).click();

            // Model options are DawChooserCard buttons named "<display>
            // <description> <params> <sizes>"; each card carries its download
            // size in GB.
            const cards = page.getByRole('button').filter({ hasText: /GB/ });
            await expect(cards.nth(0)).toBeVisible({ timeout: 10_000 });
            expect(await cards.count()).toBeGreaterThan(1);
            await expect(page.getByRole('button', { name: /Download & Load /i })).toHaveText(
                /Download & Load Standard/
            );
            await expect(page.getByText(/Downloads and verifies this model/i)).toBeVisible();
        }

        // Preferences states the privacy boundary of the automatic backend in
        // both cases: nothing leaves this browser unless a provider is chosen.
        await page.getByTestId('toggle-preferences').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'AI', exact: true }).click();
        await expect(
            dialog.getByText(
                'Automatic uses WebLLM in this browser only. Select a hosted provider explicitly to send prompts remotely.'
            )
        ).toBeVisible();
    });
});
