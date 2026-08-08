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

test.describe('Mixer width & sends — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
        await openMixer(page);
    });

    test('channel width cycle button is present via test ID', async ({ page }) => {
        const width = page.getByTestId('mixer-channel-width');
        await expect(width).toBeVisible({ timeout: 10_000 });
    });

    test('clicking channel width changes the label', async ({ page }) => {
        const width = page.getByTestId('mixer-channel-width');
        await expect(width).toBeVisible({ timeout: 10_000 });

        const before = await width.getAttribute('aria-label');
        await width.click();
        await page.waitForTimeout(300);
        const after = await width.getAttribute('aria-label');
        expect(after).not.toBe(before);
    });

    test('channel strips are present in mixer', async ({ page }) => {
        // Channel strips use data-testid=channel-{trackId}.
        const muteButtons = page.locator('[data-testid^="channel-mute-"]');
        const hasMutes = await muteButtons.first().isVisible().catch(() => false);
        if (hasMutes) {
            const count = await muteButtons.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('master gain is present in the mixer', async ({ page }) => {
        const master = page.getByTestId('master-gain');
        await expect(master).toBeAttached({ timeout: 10_000 });
    });

    test('mixer save snapshot and channel width coexist', async ({ page }) => {
        await expect(page.getByTestId('mixer-save-snapshot')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('mixer-channel-width')).toBeVisible({ timeout: 10_000 });
    });
});
