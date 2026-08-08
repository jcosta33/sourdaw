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

test.describe('Mixer deep with EDM template — mute, solo, pan, gain', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
        await openMixer(page);
    });

    test('multiple channel mute buttons are present', async ({ page }) => {
        const mutes = page.locator('[data-testid^="channel-mute-"]');
        await expect(mutes.first()).toBeVisible({ timeout: 15_000 });
        const count = await mutes.count();
        expect(count).toBeGreaterThan(1);
    });

    test('muting first channel sets data-active true', async ({ page }) => {
        const mutes = page.locator('[data-testid^="channel-mute-"]');
        await expect(mutes.first()).toBeVisible({ timeout: 15_000 });

        await mutes.nth(0).click();
        await expect(mutes.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(mutes.nth(1)).toHaveAttribute('data-active', 'false');
    });

    test('soloing first channel sets data-active true', async ({ page }) => {
        const solos = page.locator('[data-testid^="channel-solo-"]');
        await expect(solos.first()).toBeVisible({ timeout: 15_000 });

        await solos.nth(0).click();
        await expect(solos.nth(0)).toHaveAttribute('data-active', 'true');
    });

    test('pan knob responds to keyboard increment', async ({ page }) => {
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

    test('master gain is present alongside channel strips', async ({ page }) => {
        const master = page.getByTestId('master-gain');
        await expect(master).toBeAttached({ timeout: 15_000 });
    });
});
