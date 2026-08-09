import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openMixer(page: import('@playwright/test').Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const mixerTab = page.locator('#bottom-dock-tab-mixer');
    if (await mixerTab.isVisible().catch(() => false)) {
        await mixerTab.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Mixer full workflow — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
        await openMixer(page);
    });

    test('mute first channel, solo second, verify states', async ({ page }) => {
        const mutes = page.locator('[data-testid^="channel-mute-"]');
        const solos = page.locator('[data-testid^="channel-solo-"]');

        await expect(mutes.first()).toBeVisible({ timeout: 15_000 });

        await mutes.nth(0).click();
        await expect(mutes.nth(0)).toHaveAttribute('data-active', 'true');

        if ((await solos.count()) > 1) {
            await solos.nth(1).click();
            await expect(solos.nth(1)).toHaveAttribute('data-active', 'true');
        }
    });

    test('pan knob keyboard increment changes value', async ({ page }) => {
        const pan = page.locator('[data-testid^="channel-pan-"]').first();
        await expect(pan).toBeVisible({ timeout: 15_000 });

        const slider = pan.getByRole('slider');
        if (await slider.isVisible().catch(() => false)) {
            const before = await slider.getAttribute('aria-valuenow');
            await slider.focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(200);
            const after = await slider.getAttribute('aria-valuenow');
            if (Number(before) < 50) {
                expect(Number(after)).toBeGreaterThan(Number(before));
            }
        }
    });

    test('channel width cycle button changes label', async ({ page }) => {
        const width = page.getByTestId('mixer-channel-width');
        await expect(width).toBeVisible({ timeout: 15_000 });

        const before = await width.getAttribute('aria-label');
        await width.click();
        await page.waitForTimeout(300);
        const after = await width.getAttribute('aria-label');
        expect(after).not.toBe(before);
    });

    test('save snapshot button is clickable', async ({ page }) => {
        const save = page.getByTestId('mixer-save-snapshot');
        await expect(save).toBeVisible({ timeout: 15_000 });
        await save.click();
        await page.waitForTimeout(500);
        // Should not crash.
        await expect(save).toBeVisible();
    });

    test('master gain present with rendered children', async ({ page }) => {
        const master = page.getByTestId('master-gain');
        await expect(master).toBeAttached({ timeout: 15_000 });
        const childCount = await master.evaluate((el) => el.children.length);
        expect(childCount).toBeGreaterThan(0);
    });
});
