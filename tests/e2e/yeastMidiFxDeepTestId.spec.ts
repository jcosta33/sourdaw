import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openYeast(page: import('@playwright/test').Page): Promise<void> {
    // Yeast needs a selected track to attach to.
    const midi = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await midi.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click();
    await page.waitForTimeout(300);

    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    const effectsTab = page.getByRole('button', { name: 'Effects', exact: true }).first();
    if (await effectsTab.isVisible().catch(() => false)) {
        await effectsTab.click();
        await page.waitForTimeout(400);
    }
    await search.fill('yeast');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Yeast/i }).first().click();
    await page.waitForTimeout(1500);
}

test.describe('Yeast MIDI FX rack — deep', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openYeast(page);
    });

    test('added processor shows as Live in the rack read', async ({ page }) => {
        // Build level exposes the sprout shelf and the rack read.
        await page.getByRole('button', { name: 'Build' }).first().click();
        await page.waitForTimeout(400);
        await expect(page.getByText(/No processors yet/i)).toBeVisible();

        await page.getByRole('button', { name: /\+ Arpeggiator/i }).first().click();
        await page.waitForTimeout(500);

        // The processor mounts and the rack read reports it as Live (not Bypass).
        await expect(page.getByText('Arpeggiator', { exact: false }).first()).toBeVisible();
        await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/No processors yet/i)).toHaveCount(0);
    });

    test('navigating levels swaps the section title', async ({ page }) => {
        // Wait for the panel to mount at the default Play level.
        await expect(page.getByRole('button', { name: /Arp/i }).first()).toBeVisible({ timeout: 15_000 });

        // Level 1 (Play) shows the level-1 title.
        await expect(page.getByText('Play', { exact: true }).first()).toBeVisible();

        // Switch to Build (level 3) — the rack view.
        await page.getByRole('button', { name: 'Build' }).first().click();
        await page.waitForTimeout(400);
        await expect(page.getByText('Build', { exact: true }).first()).toBeVisible();
        // The rack view surfaces its empty-state guidance.
        await expect(page.getByText(/No processors yet/i)).toBeVisible();
    });

    test('sprout shelf adds a processor to the rack', async ({ page }) => {
        // Go to the Build level to see the rack.
        await page.getByRole('button', { name: 'Build' }).first().click();
        await page.waitForTimeout(400);
        await expect(page.getByText(/No processors yet/i)).toBeVisible();

        // The Sprout shelf exposes "+ <Processor>" chips. Adding one mounts it
        // in the rack and removes the empty-state message.
        await page.getByRole('button', { name: /\+ Scale Quantizer/i }).first().click();
        await page.waitForTimeout(500);

        await expect(page.getByText(/No processors yet/i)).toHaveCount(0);
        // The processor is now listed by name in the rack.
        await expect(page.getByText('Scale Quantizer', { exact: false }).first()).toBeVisible();
    });
});
