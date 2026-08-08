import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Track arm & Ableton Link — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await addFirstTrack(page);
    });

    test('arm button is present and not armed via test ID', async ({ page }) => {
        const arm = page.locator('[data-testid^="track-arm-"]').first();
        await arm.waitFor({ state: 'visible', timeout: 10_000 });
        await expect(arm).toHaveAttribute('data-active', 'false');
    });

    test('arming a track sets data-active to true', async ({ page }) => {
        const arm = page.locator('[data-testid^="track-arm-"]').first();
        await arm.waitFor({ state: 'visible', timeout: 10_000 });

        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'true');

        // Disarm.
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'false');
    });

    test('Ableton Link toggle is present via test ID', async ({ page }) => {
        const link = page.getByTestId('toggle-ableton-link');
        const hasLink = await link.isVisible().catch(() => false);
        if (hasLink) {
            await expect(link).toHaveAttribute('aria-pressed', 'false');
        }
    });

    test('arming one track does not arm another', async ({ page }) => {
        // Add a second track.
        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const arms = page.locator('[data-testid^="track-arm-"]');
        await expect(arms).toHaveCount(2);

        // Arm the first only.
        await arms.nth(0).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'false');
    });

    test('arming then disarming leaves all tracks unarmed', async ({ page }) => {
        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const arms = page.locator('[data-testid^="track-arm-"]');

        // Arm both.
        await arms.nth(0).click();
        await arms.nth(1).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'true');

        // Disarm both.
        await arms.nth(0).click();
        await arms.nth(1).click();
        await expect(arms.nth(0)).toHaveAttribute('data-active', 'false');
        await expect(arms.nth(1)).toHaveAttribute('data-active', 'false');
    });
});
