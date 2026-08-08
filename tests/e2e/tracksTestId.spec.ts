import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addFirstTrack(page: import('@playwright/test').Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
}

test.describe('Track operations — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('add MIDI track via add-track menu test ID increases track count', async ({ page }) => {
        await addFirstTrack(page);

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const initialRows = await trackList.getByRole('row').count();

        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const afterRows = await trackList.getByRole('row').count();
        expect(afterRows).toBeGreaterThan(initialRows);
    });

    test('add audio track via add-track menu test ID increases track count', async ({ page }) => {
        await addFirstTrack(page);

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const initialRows = await trackList.getByRole('row').count();

        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-audio').click();
        await page.waitForTimeout(500);

        const afterRows = await trackList.getByRole('row').count();
        expect(afterRows).toBeGreaterThan(initialRows);
    });

    test('mute toggle on track header changes data-active via test ID', async ({ page }) => {
        await addFirstTrack(page);

        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await mute.waitFor({ state: 'visible' });
        await expect(mute).toHaveAttribute('data-active', 'false');

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });

    test('solo toggle on track header changes data-active via test ID', async ({ page }) => {
        await addFirstTrack(page);

        const solo = page.locator('[data-testid^="track-solo-"]').first();
        await solo.waitFor({ state: 'visible' });
        await expect(solo).toHaveAttribute('data-active', 'false');

        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'true');

        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'false');
    });

    test('adding a second track via menu creates two distinct mute buttons', async ({ page }) => {
        await addFirstTrack(page);

        await page.getByTestId('add-track-button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const muteButtons = page.locator('[data-testid^="track-mute-"]');
        await expect(muteButtons).toHaveCount(2);
    });

    test('muting one track does not mute the other', async ({ page }) => {
        await addFirstTrack(page);

        await page.getByTestId('add-track-button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        const mutes = page.locator('[data-testid^="track-mute-"]');
        await expect(mutes).toHaveCount(2);

        await mutes.nth(0).click();
        await expect(mutes.nth(0)).toHaveAttribute('data-active', 'true');
        await expect(mutes.nth(1)).toHaveAttribute('data-active', 'false');
    });
});
