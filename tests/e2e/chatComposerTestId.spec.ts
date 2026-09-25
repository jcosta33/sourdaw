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

    // The admission badge reports whether a browser-local backend is admitted,
    // and admission requires a WebGPU device. The expectation is read from
    // Chromium's own adapter rather than assumed of the runner, so both the
    // unavailable and available branches are real assertions. The composer
    // itself stays enabled either way: it is disabled only while generating, so
    // deterministic commands run without a model. The general matrix has no
    // adapter and therefore proves the unavailable branch; the available branch
    // is proven by browserAiAdmittedPresentation.spec.ts on the hardware leg,
    // and runs here as well on a developer machine with a GPU.
    test('reports local AI admission state and closes on toggle', async ({ page }, testInfo) => {
        const input = page.getByRole('textbox', { name: 'Chat message input', exact: true });
        await expect(input).toBeVisible();

        const hardware = await probeBrowserWebGpuHardware(page);
        await testInfo.attach('webgpu-hardware-probe', {
            body: JSON.stringify(hardware),
            contentType: 'application/json',
        });

        if (hardware.status === 'unavailable') {
            // The badge is absent while detection is still running, so the
            // settled label is what distinguishes a refused backend from an
            // unfinished probe. The composer stays enabled because
            // deterministic commands run without a model — `disabled` is
            // `isGenerating` alone.
            await expect(page.getByText('AI Not Available', { exact: true })).toBeVisible();
            await expect(input).toBeEnabled();
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
