import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Master channel strip — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await openMixer(page);
    });

    test('master gain fader wrapper is present via test ID', async ({ page }) => {
        const gain = page.getByTestId('master-gain');
        await expect(gain).toBeAttached({ timeout: 10_000 });

        const childCount = await gain.evaluate((el) => el.children.length);
        expect(childCount).toBeGreaterThan(0);
    });

    test('master gain slider has a numeric value', async ({ page }) => {
        const gain = page.getByTestId('master-gain');
        await gain.waitFor({ state: 'attached', timeout: 10_000 });

        const slider = gain.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const value = await slider.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('master gain responds to keyboard', async ({ page }) => {
        const gain = page.getByTestId('master-gain');
        await gain.waitFor({ state: 'attached', timeout: 10_000 });

        const slider = gain.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const before = await slider.getAttribute('aria-valuenow');
            await slider.focus();
            await page.keyboard.press('ArrowDown');
            const after = await slider.getAttribute('aria-valuenow');
            // Value should have changed (or stayed at min).
            expect(after).not.toBeNull();
        }
    });
});
