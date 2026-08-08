import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Track context menu — text-targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('right-clicking a track opens the context menu', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const trackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();

        await trackRow.click({ button: 'right' });
        await page.waitForTimeout(300);

        // The menu should show standard items.
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
    });

    test('context menu lists Duplicate Track option', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const trackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();

        await trackRow.click({ button: 'right' });
        await page.waitForTimeout(300);

        const dupItem = page.getByRole('menuitem', { name: /Duplicate Track/i });
        await expect(dupItem).toBeVisible({ timeout: 5000 });
    });

    test('clicking Duplicate Track increases track count', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const initialRows = await trackList.getByRole('row').count();

        const trackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();
        await trackRow.click({ button: 'right' });
        await page.waitForTimeout(300);

        await page.getByRole('menuitem', { name: /Duplicate Track/i }).click();
        await page.waitForTimeout(500);

        const afterRows = await trackList.getByRole('row').count();
        expect(afterRows).toBeGreaterThan(initialRows);
    });

    test('context menu lists Rename option', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const trackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();

        await trackRow.click({ button: 'right' });
        await page.waitForTimeout(300);

        const renameItem = page.getByRole('menuitem', { name: /^Rename$/i });
        await expect(renameItem).toBeVisible({ timeout: 5000 });
    });

    test('context menu lists Add Clip option', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const trackRow = trackList.getByRole('row').filter({ hasText: /MIDI/i }).first();

        await trackRow.click({ button: 'right' });
        await page.waitForTimeout(300);

        const addClip = page.getByRole('menuitem', { name: /Add Clip/i });
        await expect(addClip).toBeVisible({ timeout: 5000 });
    });
});
