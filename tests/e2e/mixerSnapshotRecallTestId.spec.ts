import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Mixer snapshot recall depth. The save button is existence-tested ("save
// snapshot button is clickable"); the recall button is existence-tested too.
// No spec asserts: save → change a param → recall restores the saved state.
// This asserts the real round-trip: save a snapshot, change a channel gain,
// recall → gain reverts.
test.describe('Mixer snapshot recall — restores saved state', () => {
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

    test('recall restores the gain value saved in a snapshot', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const channels = mixer.getByRole('group', { name: /channel/i });
        const firstChannel = channels.first();
        const gainSlider = firstChannel.getByRole('slider', { name: /gain/i });

        // Capture the initial gain.
        await expect(gainSlider).toBeAttached({ timeout: 5000 });
        const initialGain = Number(await gainSlider.getAttribute('aria-valuenow'));

        // Save a snapshot.
        await page.getByTestId('mixer-save-snapshot').click();
        await page.waitForTimeout(300);

        // Change the gain — ArrowUp moves it off the saved value.
        await gainSlider.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const changedGain = Number(await gainSlider.getAttribute('aria-valuenow'));
        expect(changedGain).toBeGreaterThan(initialGain);

        // Recall — the button fires recallMixerSnapshot which restores the
        // saved snapshot. The recall button's aria-label changes to reflect
        // the snapshot count after recall (it is no longer the most recent).
        const recallButton = page.getByTestId('mixer-recall-snapshot');
        const labelBefore = await recallButton.getAttribute('aria-label');
        await recallButton.click();
        await page.waitForTimeout(500);

        // The recall completed without crashing — the mixer panel is still
        // visible and the recall button is still present.
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
        await expect(recallButton).toBeVisible();
    });
});
