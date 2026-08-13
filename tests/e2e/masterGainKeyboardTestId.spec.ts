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
});
