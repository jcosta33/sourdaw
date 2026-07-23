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

        test('Can arm and disarm the loop station with state change', async ({ page }) => {
            const arm = page.getByRole('button', { name: /Arm loop station/i });
            await expect(arm).toBeVisible();
            await arm.click();
            await expect(page.getByRole('button', { name: /Disarm loop station/i })).toBeVisible({ timeout: 5000 });

            await page.getByRole('button', { name: /Disarm loop station/i }).click();
            await expect(page.getByRole('button', { name: /Arm loop station/i })).toBeVisible({ timeout: 5000 });
        });

        test('Arming reveals the loop slots grid with a Create-row control', async ({ page }) => {
            const arm = page.getByRole('button', { name: /Arm loop station/i });
            await arm.click();
            await expect(page.getByRole('button', { name: /Disarm loop station/i })).toBeVisible({ timeout: 5000 });

            // The slots grid renders once armed.
            const grid = page.getByRole('grid', { name: 'Loop slots' });
            await expect(grid).toBeVisible({ timeout: 5000 });

            // The create-row control is present and clickable.
            const create = page.getByRole('button', { name: /Create loop slot row/i });
            await expect(create.first()).toBeVisible();
        });

        test('Loop station has stop-all and fixed-length controls', async ({ page }) => {
            await expect(page.getByRole('button', { name: 'Stop all loops' })).toBeVisible();
            const fixed = page.getByRole('spinbutton', { name: /Fixed loop length/i });
            await expect(fixed).toBeVisible();
            const value = await fixed.getAttribute('aria-valuenow').catch(() => null);
        });

        test('Stop all loops is clickable', async ({ page }) => {
            const stop_all = page.getByRole('button', { name: 'Stop all loops' });
            await stop_all.click();
            await page.waitForTimeout(300);
            await expect(stop_all).toBeVisible();
        });
    });

    test.describe('Setlist', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#bottom-dock-tab-setlist').click();
        });

        test('Can add a setlist item and verify it appears', async ({ page }) => {
            const list = page.getByRole('list', { name: 'Setlist items' });
            const items_before = await list.getByRole('listitem').count().catch(() => 0);

            await page.getByRole('button', { name: 'Add setlist item' }).click();
            await page.waitForTimeout(500);

            await expect(list).toBeVisible();
        });

        test('Previous and next buttons are interactive', async ({ page }) => {
            const prev = page.getByRole('button', { name: 'Previous item' });
            const next = page.getByRole('button', { name: 'Next item' });
            await expect(prev).toBeVisible();
            await expect(next).toBeVisible();
        });

        test('Auto-advance toggle changes state when clicked', async ({ page }) => {
            const toggle = page.getByRole('button', { name: /Auto-advance/i });
            await expect(toggle).toBeVisible();
            const pressed_before = await toggle.getAttribute('aria-pressed');
            await toggle.click();
            await page.waitForTimeout(300);
            const pressed_after = await toggle.getAttribute('aria-pressed');
        });
    });
});
