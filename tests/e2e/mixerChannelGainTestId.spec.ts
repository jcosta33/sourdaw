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
        const kick = mixer.getByRole('group', { name: 'Kick channel', exact: true });
        await expect(kick).toBeVisible({ timeout: 5000 });

        const gainSlider = kick.getByRole('slider', { name: 'Kick gain', exact: true });
        await expect(gainSlider).toBeAttached({ timeout: 5000 });

        await gainSlider.focus();
        const before = Number(await gainSlider.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await expect.poll(async () => Number(await gainSlider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    });

    test('track gain menu enters, resets, copies, pastes, and replays a gain change', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const first = mixer.getByRole('group', { name: 'Kick channel', exact: true });
        const second = mixer.getByRole('group', { name: 'Clap channel', exact: true });
        await expect(first).toBeVisible({ timeout: 5000 });
        await expect(second).toBeVisible({ timeout: 5000 });
        const firstGain = first.getByRole('slider', { name: 'Kick gain', exact: true });
        const secondGain = second.getByRole('slider', { name: 'Clap gain', exact: true });
        const firstCap = firstGain.locator('[data-role="fader-cap"]');
        const secondCap = secondGain.locator('[data-role="fader-cap"]');
        await expect(firstGain).toBeAttached();
        await expect(secondGain).toBeAttached();
        await expect(firstCap).toBeVisible();
        await expect(secondCap).toBeVisible();

        await firstCap.click({ button: 'right' });
        const firstMenu = page.getByRole('menu', { name: /gain actions/i });
        await expect(firstMenu).toBeVisible();
        await expect(firstMenu.getByRole('menuitem')).toHaveCount(4);
        await expect(firstMenu.getByRole('menuitem', { name: 'Enter Value' })).toBeVisible();
        await expect(firstMenu.getByRole('menuitem', { name: 'Reset to Default' })).toBeVisible();
        await expect(firstMenu.getByRole('menuitem', { name: 'Copy Value' })).toBeVisible();
        await expect(firstMenu.getByRole('menuitem', { name: 'Paste Value' })).toBeVisible();
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
        await expect(firstMenu.getByRole('menuitem', { name: 'Reset to Default' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(firstMenu).toHaveCount(0);
        await expect(firstGain).toBeFocused();

        await page.keyboard.press('Shift+F10');
        await expect(firstMenu.getByRole('menuitem', { name: 'Reset to Default' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(firstMenu).toHaveCount(0);
        await expect(firstGain).toHaveAttribute('aria-valuenow', '0.8');
        await firstCap.click({ button: 'right' });
        await firstMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Gain' }).fill('-6 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect(first.getByText('-6.0 dB')).toBeVisible();
        const copiedValue = await firstGain.getAttribute('aria-valuenow');

        await firstCap.click({ button: 'right' });
        await firstMenu.getByRole('menuitem', { name: 'Copy Value' }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`gain:${copiedValue}`);
        await secondCap.click({ button: 'right' });
        const secondMenu = page.getByRole('menu', { name: /gain actions/i });
        await secondMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Gain' }).fill('-12 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect(second.getByText('-12.0 dB')).toBeVisible();
        const beforePaste = await secondGain.getAttribute('aria-valuenow');
        expect(beforePaste).not.toBe(copiedValue);
        await secondCap.click({ button: 'right' });
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

        await secondCap.click({ button: 'right' });
        await expect(secondMenu).toBeVisible();
        await page.evaluate(() => navigator.clipboard.writeText('gain:invalid'));
        await secondMenu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(secondGain).toHaveAttribute('aria-valuenow', copiedValue ?? '');
        await expect(page.getByText('Clipboard does not contain a valid track gain value.')).toBeVisible();
    });

    test('track pan menu resets, enters exact values, copies, pastes, and replays pan changes', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const mixer = page.getByRole('region', { name: 'Mixer panel' });
        const kick = mixer.getByRole('group', { name: 'Kick channel', exact: true });
        const clap = mixer.getByRole('group', { name: 'Clap channel', exact: true });
        await expect(kick).toBeVisible({ timeout: 5000 });
        await expect(clap).toBeVisible({ timeout: 5000 });
        const kickPan = kick.getByRole('slider', { name: 'Kick pan', exact: true });
        const clapPan = clap.getByRole('slider', { name: 'Clap pan', exact: true });
        await expect(kickPan).toBeAttached();
        await expect(clapPan).toBeAttached();
        await expect(kickPan).toBeVisible();
        await expect(clapPan).toBeVisible();

        await kickPan.click({ button: 'right' });
        const kickMenu = page.getByRole('menu', { name: 'Kick pan actions' });
        await expect(kickMenu).toBeVisible();
        await expect(kickMenu.getByRole('menuitem')).toHaveCount(4);
        await kickMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        const prompt = page.getByRole('dialog', { name: 'Enter Track Pan' });
        await expect(prompt).toBeVisible();
        await prompt.getByRole('textbox', { name: 'Enter Track Pan' }).fill('8.125');
        await prompt.getByRole('button', { name: 'Set Pan' }).click();
        await expect(kickPan).toHaveAttribute('aria-valuenow', '8.125');

        await kickPan.focus();
        await page.keyboard.press('Shift+F10');
        await expect(kickMenu.getByRole('menuitem', { name: 'Reset to Default' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(kickPan).toHaveAttribute('aria-valuenow', '0');

        await kickPan.click({ button: 'right' });
        await kickMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Pan' }).fill('-12.375');
        await prompt.getByRole('button', { name: 'Set Pan' }).click();
        await expect(kickPan).toHaveAttribute('aria-valuenow', '-12.375');
        await kickPan.click({ button: 'right' });
        await kickMenu.getByRole('menuitem', { name: 'Copy Value' }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('pan:-12.375');

        await clapPan.click({ button: 'right' });
        const clapMenu = page.getByRole('menu', { name: 'Clap pan actions' });
        await clapMenu.getByRole('menuitem', { name: 'Enter Value' }).click();
        await prompt.getByRole('textbox', { name: 'Enter Track Pan' }).fill('4.5');
        await prompt.getByRole('button', { name: 'Set Pan' }).click();
        const beforePaste = await clapPan.getAttribute('aria-valuenow');
        expect(beforePaste).toBe('4.5');
        await clapPan.click({ button: 'right' });
        await clapMenu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(clapPan).toHaveAttribute('aria-valuenow', '-12.375');

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        await undo.click();
        await expect(clapPan).toHaveAttribute('aria-valuenow', beforePaste ?? '');
        await redo.click();
        await expect(clapPan).toHaveAttribute('aria-valuenow', '-12.375');

        await page.evaluate(() => navigator.clipboard.writeText('gain:0.25'));
        await clapPan.click({ button: 'right' });
        await clapMenu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(clapPan).toHaveAttribute('aria-valuenow', '-12.375');
        await expect(page.getByText('Clipboard does not contain a valid track pan value.')).toBeVisible();
    });
});
