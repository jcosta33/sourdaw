import { test, expect } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

async function openTab(page: import('@playwright/test').Page, tabId: string): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }
    const tab = page.locator(`#bottom-dock-tab-${tabId}`);
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Session view & loop station deep — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('session view shows track columns', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        // Scene buttons visible.
        await expect(page.getByRole('button', { name: 'Launch scene 1' })).toBeVisible({ timeout: 5000 });

        // Multiple scenes.
        const scenes = page.getByRole('button', { name: /Launch scene \d/i });
        expect(await scenes.count()).toBe(8);
    });

    test('clicking scene 1 then scene 2 works', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        await page.getByRole('button', { name: 'Launch scene 1' }).click();
        await page.waitForTimeout(300);

        await page.getByRole('button', { name: 'Launch scene 2' }).click();
        await page.waitForTimeout(300);

        // Transport should still work.
        await expect(page.getByTestId('transport-play')).toBeVisible();
    });

    // setlistLoopStationTestId owns unconditional loop region and Arm to Disarm coverage.
    test('session view and loop station can be viewed sequentially', async ({ page }) => {
        // Open session view.
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);
        await expect(page.getByRole('button', { name: 'Launch scene 1' })).toBeVisible({ timeout: 5000 });

        // Disable dual view.
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        // Open loop station.
        await openTab(page, 'loopStation');
        // Should not crash.
        await expect(page.getByTestId('transport-play')).toBeVisible();
    });

    test('transport play works with session view open', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(600);

        const playhead = page.getByTestId('transport-playhead');
        expect((await playhead.innerText()).trim()).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });
});
