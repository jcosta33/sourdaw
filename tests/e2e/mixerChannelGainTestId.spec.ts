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
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();
    });

    test('channel gain fader responds to ArrowUp', async ({ page }) => {
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const channels = mixer.locator('[role="group"][data-testid^="channel-"]');
        await expect(channels.first()).toBeVisible({ timeout: 5000 });

        // Find the first channel's gain slider by aria-label.
        const firstChannel = channels.first();
        const gainSlider = firstChannel.getByRole('slider', { name: /gain/i });
        await expect(gainSlider).toBeAttached({ timeout: 5000 });

        await gainSlider.focus();
        const before = Number(await gainSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => Number(await gainSlider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    });

    test('track gain menu enters, resets, copies, pastes, and replays a gain change', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const channels = mixer.locator('[role="group"][data-testid^="channel-"]');
        await expect(channels.nth(1)).toBeVisible({ timeout: 5000 });
        const first = channels.nth(0);
        const second = channels.nth(1);
        const firstGain = first.getByRole('slider', { name: /gain/i });
        const secondGain = second.getByRole('slider', { name: /gain/i });
        await expect(firstGain).toBeVisible();
        await expect(secondGain).toBeVisible();

        await firstGain.click({ button: 'right' });
        const firstMenu = page.getByRole('menu', { name: /gain actions/i });
        await expect(firstMenu).toBeVisible();
        await expect(firstMenu.getByRole('menuitem')).toHaveCount(4);
        await expect(page.getByRole('menuitem', { name: 'Mute' })).toHaveCount(0);
        await firstMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        const prompt = page.getByRole('dialog', { name: 'Enter Track Gain' });
        await expect(prompt).toBeVisible();
        await prompt.getByRole('textbox', { name: 'Enter Track Gain' }).fill('-6 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect
            .poll(async () => Number(await firstGain.getAttribute('aria-valuenow')))
            .toBeCloseTo(10 ** (-6 / 20), 5);
        await expect(first.getByText('-6.0 dB')).toBeVisible();

        await firstGain.focus();
        await page.keyboard.press('Shift+F10');
        await expect(firstMenu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(firstMenu).toHaveCount(0);
        await expect(firstGain).toBeFocused();

        await firstGain.click({ button: 'right' });
        await firstMenu.getByRole('menuitem', { name: 'Reset to Default' }).click();
        await expect(firstGain).toHaveAttribute('aria-valuenow', '0.8');
        await firstGain.click({ button: 'right' });
        await firstMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Gain' }).fill('-6 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect(first.getByText('-6.0 dB')).toBeVisible();
        const copiedValue = await firstGain.getAttribute('aria-valuenow');

        await firstGain.click({ button: 'right' });
        await firstMenu.getByRole('menuitem', { name: 'Copy Value' }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`gain:${copiedValue}`);
        await secondGain.click({ button: 'right' });
        const secondMenu = page.getByRole('menu', { name: /gain actions/i });
        await secondMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Gain' }).fill('-12 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect(second.getByText('-12.0 dB')).toBeVisible();
        const beforePaste = await secondGain.getAttribute('aria-valuenow');
        expect(beforePaste).not.toBe(copiedValue);
        await secondGain.click({ button: 'right' });
        await secondMenu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(secondGain).toHaveAttribute('aria-valuenow', copiedValue ?? '');

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(secondGain).toHaveAttribute('aria-valuenow', beforePaste ?? '');
        await expect(redo).toBeEnabled();
        await redo.click();
        await expect(secondGain).toHaveAttribute('aria-valuenow', copiedValue ?? '');

        await secondGain.click({ button: 'right' });
        await expect(secondMenu).toBeVisible();
        await page.evaluate(() => navigator.clipboard.writeText('gain:invalid'));
        await secondMenu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(secondGain).toHaveAttribute('aria-valuenow', copiedValue ?? '');
        await expect(page.getByText('Clipboard does not contain a valid track gain value.')).toBeVisible();
    });
});
