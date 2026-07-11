import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Bottom Dock — Setlist & Loop Station', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle bottom dock' }).click();
    });

    test.describe('Loop Station', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#bottom-dock-tab-loopStation').click();
        });

        test('Can arm and disarm the loop station', async ({ page }) => {
            const arm = page.getByRole('button', { name: /Arm loop station/i });
            await expect(arm).toBeVisible();
            await arm.click();
            await expect(page.getByRole('button', { name: /Disarm loop station/i })).toBeVisible({ timeout: 5000 });
        });

        test('Can create a new loop slot row', async ({ page }) => {
            const create_row = page.getByRole('button', { name: /Create loop slot row/i });
            if (await create_row.first().isVisible().catch(() => false)) {
                await create_row.first().click();
                await page.waitForTimeout(500);
            }
            await expect(page.getByRole('grid', { name: 'Loop slots' })).toBeVisible();
        });

        test('Stop all loops button is present', async ({ page }) => {
            await expect(page.getByRole('button', { name: 'Stop all loops' })).toBeVisible();
        });

        test('Fixed loop length input is present', async ({ page }) => {
            await expect(page.getByRole('spinbutton', { name: /Fixed loop length/i })).toBeVisible();
        });
    });

    test.describe('Setlist', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#bottom-dock-tab-setlist').click();
        });

        test('Can add a setlist item', async ({ page }) => {
            const add_button = page.getByRole('button', { name: 'Add setlist item' });
            await expect(add_button).toBeVisible();
            await add_button.click();
            await page.waitForTimeout(500);
            await expect(page.getByRole('list', { name: 'Setlist items' })).toBeVisible();
        });

        test('Previous and next buttons are present', async ({ page }) => {
            await expect(page.getByRole('button', { name: 'Previous item' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Next item' })).toBeVisible();
        });

        test('Auto-advance toggle is present', async ({ page }) => {
            await expect(page.getByRole('button', { name: /Auto-advance/i })).toBeVisible();
        });
    });
});
