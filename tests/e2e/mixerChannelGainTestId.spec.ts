import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Mixer channel-strip gain keyboard response. Pan is covered at depth (keyboard
// increment); the per-channel gain fader is existence-only ("present with
// rendered children"). This asserts ArrowUp on a channel fader changes the value.
test.describe('Mixer channel gain — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        if (!/true/i.test((await dock.getAttribute('aria-pressed')) ?? '')) {
            await dock.click();
        }
        await page.waitForTimeout(500);
    });

    test('channel gain fader responds to ArrowUp', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const channels = mixer.getByRole('group', { name: /channel/i });
        await expect(channels.first()).toBeVisible({ timeout: 5000 });

        // Find the first channel's gain slider by aria-label.
        const firstChannel = channels.first();
        const gainSlider = firstChannel.getByRole('slider', { name: /gain/i });
        await expect(gainSlider).toBeAttached({ timeout: 5000 });

        await gainSlider.focus();
        const before = Number(await gainSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gainSlider.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
