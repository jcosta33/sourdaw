import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Track list header — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('track height cycle button is present via test ID', async ({ page }) => {
        const height = page.getByTestId('track-height-cycle');
        await expect(height).toBeVisible({ timeout: 10_000 });
        // The aria-label should contain a height label.
        const label = await height.getAttribute('aria-label');
        expect(label).toContain('Track height');
    });

    test('clicking track height cycle changes the label', async ({ page }) => {
        const height = page.getByTestId('track-height-cycle');
        await expect(height).toBeVisible({ timeout: 10_000 });

        const before = await height.getAttribute('aria-label');
        await height.click();
        await page.waitForTimeout(300);
        const after = await height.getAttribute('aria-label');
        expect(after).not.toBe(before);
    });

    test('add folder button is present via test ID', async ({ page }) => {
        const folder = page.getByTestId('add-folder-button');
        await expect(folder).toBeVisible({ timeout: 10_000 });
    });

    test('clicking add folder creates a folder track', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const initialRows = await trackList.getByRole('row').count();

        const folder = page.getByTestId('add-folder-button');
        await folder.click();
        await page.waitForTimeout(500);

        const afterRows = await trackList.getByRole('row').count();
        expect(afterRows).toBeGreaterThan(initialRows);
    });

    test('add track button is present alongside height and folder buttons', async ({ page }) => {
        await expect(page.getByTestId('add-track-button')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('track-height-cycle')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('add-folder-button')).toBeVisible({ timeout: 10_000 });
    });
});
