import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Session view — clip launcher', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('enabling Session + Arrangement dual view shows session grid', async ({ page }) => {
        const dualView = page.getByTestId('toggle-dual-view');
        await dualView.click();
        await page.waitForTimeout(500);

        // Scene launch buttons should appear.
        const scene1 = page.getByRole('button', { name: 'Launch scene 1' });
        await expect(scene1).toBeVisible({ timeout: 5000 });
    });

    test('session view shows 8 scene launch buttons', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        for (let i = 1; i <= 8; i += 1) {
            const scene = page.getByRole('button', { name: `Launch scene ${i}` });
            await expect(scene).toBeVisible({ timeout: 5000 });
        }
    });

    test('clicking a scene launch button does not crash', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        const scene1 = page.getByRole('button', { name: 'Launch scene 1' });
        await scene1.click();
        await page.waitForTimeout(300);

        // The transport should still be functional.
        await expect(page.getByTestId('transport-play')).toBeVisible();
    });

    test('disabling dual view hides session grid', async ({ page }) => {
        const dualView = page.getByTestId('toggle-dual-view');
        await dualView.click();
        await page.waitForTimeout(500);

        // Scene buttons visible.
        await expect(page.getByRole('button', { name: 'Launch scene 1' })).toBeVisible();

        // Disable.
        await dualView.click();
        await page.waitForTimeout(500);

        // Scene buttons should be gone.
        await expect(page.getByRole('button', { name: 'Launch scene 1' })).not.toBeVisible();
    });

    test('session view coexists with transport controls', async ({ page }) => {
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        await expect(page.getByRole('button', { name: 'Launch scene 1' })).toBeVisible();
        await expect(page.getByTestId('transport-play')).toBeVisible();
        await expect(page.getByTestId('transport-stop')).toBeVisible();
    });
});
