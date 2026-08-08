import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Device panels from template — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('EDM template loads with multiple tracks', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const rows = trackList.getByRole('row');
        await expect(rows.nth(0)).toBeVisible({ timeout: 15_000 });
        const count = await rows.count();
        expect(count).toBeGreaterThan(2);
    });

    test('EDM template tracks can be muted independently', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const mutes = trackList.locator('[data-testid^="track-mute-"]');
        await expect(mutes.first()).toBeVisible({ timeout: 15_000 });

        const count = await mutes.count();
        expect(count).toBeGreaterThan(0);

        // Mute the first track.
        await mutes.nth(0).click();
        await expect(mutes.nth(0)).toHaveAttribute('data-active', 'true');
    });

    test('EDM template tracks can be soloed', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const solos = trackList.locator('[data-testid^="track-solo-"]');
        await expect(solos.first()).toBeVisible({ timeout: 15_000 });

        await solos.nth(0).click();
        await expect(solos.nth(0)).toHaveAttribute('data-active', 'true');
    });

    test('transport controls work with template tracks', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        await expect(play).toBeVisible({ timeout: 15_000 });

        await play.click();
        await page.waitForTimeout(600);

        const playhead = page.getByTestId('transport-playhead');
        const movingText = (await playhead.innerText()).trim();
        expect(movingText).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('EDM template playhead starts at 1.1.000', async ({ page }) => {
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).toBeVisible({ timeout: 15_000 });
        await expect(playhead).toHaveText(/1\.1\.000/);
    });
});
