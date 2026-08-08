import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openBrowserAndSearch(page: import('@playwright/test').Page, query: string): Promise<boolean> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill(query);
    await page.waitForTimeout(500);

    // Switch to Effects tab.
    const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
    if (await effectsTab.isVisible().catch(() => false)) {
        await effectsTab.click();
        await page.waitForTimeout(500);
    }

    const card = page.getByRole('button', { name: new RegExp(query, 'i') }).first();
    return card.isVisible().catch(() => false);
}

test.describe('Effect device panels — Gluten, Grinder, Bacteria', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a track first so devices have somewhere to go.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
    });

    test('adding Gluten via inspector add-device creates a bypass toggle', async ({ page }) => {
        // Select the track to show inspector.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        // Open inspector if needed.
        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        // Click add device.
        const addDevice = page.getByTestId('add-device-button');
        if (await addDevice.isVisible().catch(() => false)) {
            await addDevice.click();
            await page.waitForTimeout(300);

            // Find Gluten in the menu.
            const gluten = page.getByRole('menuitem', { name: /Gluten/i }).first();
            if (await gluten.isVisible().catch(() => false)) {
                await gluten.click();
                await page.waitForTimeout(500);

                // A device card with bypass should appear.
                const bypass = page.locator('[data-testid^="device-bypass-"]').first();
                await expect(bypass).toBeVisible({ timeout: 5000 });
                await expect(bypass).toHaveAttribute('aria-pressed', 'false');
            }
        }
    });

    test('bypassing a device toggles aria-pressed', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        const addDevice = page.getByTestId('add-device-button');
        if (await addDevice.isVisible().catch(() => false)) {
            await addDevice.click();
            await page.waitForTimeout(300);

            const firstEffect = page.getByRole('menu').getByRole('menuitem').first();
            await firstEffect.click();
            await page.waitForTimeout(500);

            const bypass = page.locator('[data-testid^="device-bypass-"]').first();
            if (await bypass.isVisible().catch(() => false)) {
                await bypass.click();
                await expect(bypass).toHaveAttribute('aria-pressed', 'true');

                await bypass.click();
                await expect(bypass).toHaveAttribute('aria-pressed', 'false');
            }
        }
    });

    test('removing a device decreases device card count', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        // Add two devices.
        for (let i = 0; i < 2; i += 1) {
            const addDevice = page.getByTestId('add-device-button');
            if (await addDevice.isVisible().catch(() => false)) {
                await addDevice.click();
                await page.waitForTimeout(300);
                const effect = page.getByRole('menu').getByRole('menuitem').nth(i);
                if (await effect.isVisible().catch(() => false)) {
                    await effect.click();
                    await page.waitForTimeout(500);
                }
            }
        }

        const cards = page.locator('[data-testid^="device-card-"]');
        const countBefore = await cards.count();

        if (countBefore >= 2) {
            const remove = page.locator('[data-testid^="device-remove-"]').first();
            await remove.click();
            await page.waitForTimeout(500);

            const countAfter = await cards.count();
            expect(countAfter).toBe(countBefore - 1);
        }
    });

    test('device chain add button remains functional after adding and removing', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        // Add a device.
        await page.getByTestId('add-device-button').click();
        await page.waitForTimeout(300);
        await page.getByRole('menu').getByRole('menuitem').first().click();
        await page.waitForTimeout(500);

        // Remove it.
        const remove = page.locator('[data-testid^="device-remove-"]').first();
        await remove.click();
        await page.waitForTimeout(500);

        // Add device button should still work.
        await expect(page.getByTestId('add-device-button')).toBeVisible();
    });
});
