import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    // Select the track to show the inspector.
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().click();
    await page.waitForTimeout(300);
}

test.describe('Device chain — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('add device button is present in the inspector via test ID', async ({ page }) => {
        const addDevice = page.getByTestId('add-device-button');
        await expect(addDevice).toBeVisible({ timeout: 10_000 });
    });

    test('clicking add device opens a menu with effect options', async ({ page }) => {
        const addDevice = page.getByTestId('add-device-button');
        await addDevice.click();
        await page.waitForTimeout(300);

        // The menu should show effect options.
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        // At least one menu item should be present.
        const items = menu.getByRole('menuitem');
        expect(await items.count()).toBeGreaterThan(0);
    });

    test('adding a device creates a device card via test ID', async ({ page }) => {
        const addDevice = page.getByTestId('add-device-button');
        await addDevice.click();
        await page.waitForTimeout(300);

        // Click the first available effect.
        const firstEffect = page.getByRole('menu').getByRole('menuitem').first();
        await firstEffect.click();
        await page.waitForTimeout(500);

        // A device card should now exist.
        const deviceCard = page.locator('[data-testid^="device-card-"]').first();
        await expect(deviceCard).toBeVisible({ timeout: 5000 });
    });

    test('bypass toggle on a device changes aria-pressed via test ID', async ({ page }) => {
        // Add a device first.
        await page.getByTestId('add-device-button').click();
        await page.waitForTimeout(300);
        await page.getByRole('menu').getByRole('menuitem').first().click();
        await page.waitForTimeout(500);

        const bypass = page.locator('[data-testid^="device-bypass-"]').first();
        await bypass.waitFor({ state: 'visible' });
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');

        await bypass.click();
        await expect(bypass).toHaveAttribute('aria-pressed', 'true');

        await bypass.click();
        await expect(bypass).toHaveAttribute('aria-pressed', 'false');
    });

    test('removing a device decreases the device card count via test ID', async ({ page }) => {
        // Add a device first.
        await page.getByTestId('add-device-button').click();
        await page.waitForTimeout(300);
        await page.getByRole('menu').getByRole('menuitem').first().click();
        await page.waitForTimeout(500);

        const cards = page.locator('[data-testid^="device-card-"]');
        const countBefore = await cards.count();
        expect(countBefore).toBeGreaterThan(0);

        const removeBtn = page.locator('[data-testid^="device-remove-"]').first();
        await removeBtn.click();
        await page.waitForTimeout(500);

        const countAfter = await cards.count();
        expect(countAfter).toBe(countBefore - 1);
    });
});
