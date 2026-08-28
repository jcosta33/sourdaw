import { expect, test, type Page } from '@playwright/test';

import { probeBrowserWebGpuHardware } from './browserAiHardware';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openChatPanel(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
    await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('log', { name: 'Chat conversation' })).toBeVisible();
}

test.describe('Chat composer', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openChatPanel(page);
    });

    // The composer is enabled by an admitted backend, and browser-local
    // admission requires a WebGPU device. The expectation is read from
    // Chromium's own adapter rather than assumed of the runner, so the
    // enabled and disabled contracts are both real assertions.
    test('follows local AI admission and closes on toggle', async ({ page }, testInfo) => {
        const input = page.getByRole('textbox', { name: 'Chat message input', exact: true });
        await expect(input).toBeVisible();

        const hardware = await probeBrowserWebGpuHardware(page);
        await testInfo.attach('webgpu-hardware-probe', {
            body: JSON.stringify(hardware),
            contentType: 'application/json',
        });

        if (hardware.status === 'unavailable') {
            // Asserted before the disabled state: the composer is also disabled
            // while detection is still running, so the settled label is what
            // distinguishes a refused backend from an unfinished probe.
            await expect(page.getByText('AI Not Available', { exact: true })).toBeVisible();
            await expect(input).toBeDisabled();
        } else {
            await expect(input).toBeEnabled();
            await expect(page.getByText('AI Not Available', { exact: true })).toHaveCount(0);
            await expect(page.getByText('Checking AI availability', { exact: true })).toHaveCount(0);
        }

        const toggle = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(input).toHaveCount(0);
        await expect(page.getByRole('log', { name: 'Chat conversation' })).toHaveCount(0);
    });
});
