import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
    getBrowserAiWebGpuHardwareRequirement,
    probeBrowserWebGpuHardware,
    requireBrowserWebGpuHardware,
} from './browserAiHardware';
import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The admitted half of the AI availability contract.
 *
 * `aiAndCollabFinal`, `chatComposerTestId`, and `llmBadgeDownload` each branch
 * on this browser's WebGPU admission, and the general Chromium matrix runs
 * without hardware, so only their refused branch executes there. These
 * assertions are the admitted branch, and this file is in the hardware leg's
 * `testMatch` so `browserAiWebGpuHardware: 'required'` makes a runner without a
 * core non-fallback adapter fail here rather than skip. Nothing in this file may
 * be reached by a runner that has no adapter.
 */

async function admitsHardwareWebGpu(page: Page, testInfo: TestInfo): Promise<boolean> {
    const hardware = await probeBrowserWebGpuHardware(page);
    await testInfo.attach('webgpu-hardware-probe', {
        body: JSON.stringify(hardware),
        contentType: 'application/json',
    });
    if (getBrowserAiWebGpuHardwareRequirement(testInfo.project.metadata) === 'required') {
        requireBrowserWebGpuHardware(hardware);
    }
    return hardware.status === 'supported';
}

test('offers browser model onboarding once a WebGPU device is admitted', async ({ page }, testInfo) => {
    // Matches the sibling admission proof: this leg's first navigation pays
    // Vite's cold transform before the launch screen can be observed.
    test.setTimeout(180_000);
    await setupWorkspace(page);
    await launch_new_project(page);

    if (!(await admitsHardwareWebGpu(page, testInfo))) {
        return;
    }

    await expect(page.getByText('AI unavailable', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load AI', exact: true }).click();

    // Model options are DawChooserCard buttons named "<display> <description>
    // <params> <sizes>", so each carries its download size in GB.
    const cards = page.getByRole('button').filter({ hasText: /GB/ });
    await expect(cards.nth(0)).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBeGreaterThan(1);

    // The download button's label is the per-model contract: it names the
    // selected model, so selecting a card retitles it.
    const downloadButton = page.getByRole('button', { name: /Download & Load /i });
    await expect(downloadButton).toHaveText(/Download & Load Standard/);

    await cards.filter({ hasText: 'Pro' }).first().click();
    await expect(downloadButton).toHaveText(/Download & Load Pro/);

    await cards.filter({ hasText: 'Light' }).first().click();
    await expect(downloadButton).toHaveText(/Download & Load Light/);

    await expect(page.getByText(/Downloads and verifies this model/i)).toBeVisible();
});

test('enables the chat composer once a WebGPU device is admitted', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await setupWorkspace(page);
    await launch_new_project(page);

    if (!(await admitsHardwareWebGpu(page, testInfo))) {
        return;
    }

    const toggle = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
    await toggle.click();
    await expect(page.getByRole('log', { name: 'Chat conversation' })).toBeVisible();

    const input = page.getByRole('textbox', { name: 'Chat message input', exact: true });
    await expect(input).toBeEnabled();
    await expect(page.getByText('AI Not Available', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Checking AI availability', { exact: true })).toHaveCount(0);
});
