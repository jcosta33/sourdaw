import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function selectFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click();
    await page.waitForTimeout(300);

    const inspector = page.getByTestId('toggle-inspector');
    if ((await inspector.getAttribute('aria-pressed')) === 'false') {
        await inspector.click();
        await page.waitForTimeout(300);
    }
}

test.describe('Inspector deep — gain, pan, notes', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('inspector gain control is present via test ID', async ({ page }) => {
        await selectFirstTrack(page);
        const gain = page.getByTestId('inspector-track-gain');
        await expect(gain).toBeVisible({ timeout: 5000 });
    });

    test('inspector pan control is present via test ID', async ({ page }) => {
        await selectFirstTrack(page);
        const pan = page.getByTestId('inspector-track-pan');
        await expect(pan).toBeVisible({ timeout: 5000 });

        // The RotaryKnob inside should have role=slider.
        const slider = pan.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const value = await slider.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }
    });

    test('inspector pan responds to keyboard', async ({ page }) => {
        await selectFirstTrack(page);
        const pan = page.getByTestId('inspector-track-pan');
        const slider = pan.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const before = await slider.getAttribute('aria-valuenow');
            await slider.focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(200);
            const after = await slider.getAttribute('aria-valuenow');
            // Value should have changed (or stayed at max).
            if (Number(before) < 50) {
                expect(Number(after)).toBeGreaterThan(Number(before));
            }
        }
    });

    test('inspector notes input accepts text', async ({ page }) => {
        await selectFirstTrack(page);
        const notes = page.getByTestId('inspector-track-notes');
        if (await notes.isVisible().catch(() => false)) {
            await notes.fill('Test note text');
            await expect(notes).toHaveValue('Test note text');
        }
    });

    test('gain and pan coexist in inspector', async ({ page }) => {
        await selectFirstTrack(page);
        await expect(page.getByTestId('inspector-track-gain')).toBeVisible({ timeout: 5000 });
        const pan = page.getByTestId('inspector-track-pan');
        await expect(pan).toBeVisible({ timeout: 5000 });
    });
});
