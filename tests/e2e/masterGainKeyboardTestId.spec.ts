import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// Master gain keyboard response. The existing master-channel spec asserts the
// fader wrapper EXISTS (masterChannelTestId) but never tests that keyboard
// changes the value — and its own "responds to keyboard" case hides behind a
// visibility skip-guard. This asserts the mixer's master fader responds to
// ArrowUp with no guard.
//
// The Fader's slider root is a zero-width flex container (its track and cap are
// absolutely positioned and overflow it), so Playwright treats it as hidden
// even though it is attached, focusable, and in the accessibility tree. The
// contract here is therefore attach + focus + keyboard, not visibility.
async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Mixer master gain — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openMixer(page);
    });

    test('master gain slider responds to ArrowUp', async ({ page }) => {
        const gain = page.getByTestId('master-gain').getByRole('slider');
        await expect(gain).toBeAttached({ timeout: 10_000 });
        await gain.focus();
        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });

    test('master gain menu copies, pastes, and replays exact gain values', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const gain = page.getByTestId('master-gain').getByRole('slider', { name: 'Master gain' });
        const cap = gain.locator('[data-role="fader-cap"]');
        await expect(gain).toBeAttached();
        await gain.focus();
        await expect(cap).toBeVisible();

        const openMenu = async (): Promise<import('@playwright/test').Locator> => {
            await cap.click({ button: 'right' });
            return page.getByRole('menu', { name: 'Master gain actions' });
        };
        let menu = await openMenu();
        await expect(menu.getByRole('menuitem')).toHaveCount(4);
        await menu.getByRole('menuitem', { name: 'Enter Value' }).click();
        const prompt = page.getByRole('dialog', { name: 'Enter Master Gain' });
        await prompt.getByRole('textbox', { name: 'Enter Master Gain' }).fill('-6 dB');
        await prompt.getByRole('button', { name: 'Set Gain' }).click();
        await expect.poll(async () => Number(await gain.getAttribute('aria-valuenow'))).toBeCloseTo(10 ** (-6 / 20), 5);

        const copiedValue = await gain.getAttribute('aria-valuenow');
        menu = await openMenu();
        await menu.getByRole('menuitem', { name: 'Copy Value' }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`gain:${copiedValue}`);

        menu = await openMenu();
        await menu.getByRole('menuitem', { name: 'Reset to Default' }).click();
        await expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        menu = await openMenu();
        await menu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(gain).toHaveAttribute('aria-valuenow', copiedValue ?? '');

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        await undo.click();
        await expect(gain).toHaveAttribute('aria-valuenow', '0.8');
        await redo.click();
        await expect(gain).toHaveAttribute('aria-valuenow', copiedValue ?? '');

        await page.evaluate(() => navigator.clipboard.writeText('pan:0.25'));
        menu = await openMenu();
        await menu.getByRole('menuitem', { name: 'Paste Value' }).click();
        await expect(gain).toHaveAttribute('aria-valuenow', copiedValue ?? '');
        await expect(page.getByText('Clipboard does not contain a valid master gain value.')).toBeVisible();
    });
});
