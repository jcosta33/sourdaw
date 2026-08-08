import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Multi-track workflow — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('soloing one track mutes others visually', async ({ page }) => {
        const solos = page.locator('[data-testid^="track-solo-"]');
        const count = await solos.count();
        if (count >= 2) {
            // Solo first track.
            await solos.nth(0).click();
            await expect(solos.nth(0)).toHaveAttribute('data-active', 'true');

            // Other tracks should not be soloed.
            await expect(solos.nth(1)).toHaveAttribute('data-active', 'false');
        }
    });

    test('switching solo from track 1 to track 2', async ({ page }) => {
        const solos = page.locator('[data-testid^="track-solo-"]');
        const count = await solos.count();
        if (count >= 2) {
            await solos.nth(0).click();
            await expect(solos.nth(0)).toHaveAttribute('data-active', 'true');

            // Solo second track (exclusive solo).
            await solos.nth(1).click();
            await expect(solos.nth(1)).toHaveAttribute('data-active', 'true');
            // First should be unsoloed (exclusive).
            await expect(solos.nth(0)).toHaveAttribute('data-active', 'false');
        }
    });

    test('muting all tracks then unmuting', async ({ page }) => {
        const mutes = page.locator('[data-testid^="track-mute-"]');
        const count = await mutes.count();

        // Mute all.
        for (let i = 0; i < count; i += 1) {
            await mutes.nth(i).click();
            await page.waitForTimeout(100);
        }

        // All should be muted.
        for (let i = 0; i < count; i += 1) {
            await expect(mutes.nth(i)).toHaveAttribute('data-active', 'true');
        }

        // Unmute all.
        for (let i = 0; i < count; i += 1) {
            await mutes.nth(i).click();
            await page.waitForTimeout(100);
        }

        for (let i = 0; i < count; i += 1) {
            await expect(mutes.nth(i)).toHaveAttribute('data-active', 'false');
        }
    });

    test('adding a new track via menu increases count', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const initialRows = await trackList.getByRole('row').count();

        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const afterRows = await trackList.getByRole('row').count();
        expect(afterRows).toBeGreaterThan(initialRows);
    });

    test('transport play/stop works with all tracks muted', async ({ page }) => {
        const mutes = page.locator('[data-testid^="track-mute-"]');
        const count = await mutes.count();

        // Mute all.
        for (let i = 0; i < count; i += 1) {
            await mutes.nth(i).click();
            await page.waitForTimeout(100);
        }

        // Play should still work.
        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(500);

        const playhead = page.getByTestId('transport-playhead');
        const movingText = (await playhead.innerText()).trim();
        expect(movingText).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });
});
