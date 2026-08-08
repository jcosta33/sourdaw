import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Mixer channel strip — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);

        // Add a MIDI track so there's at least one channel strip in the mixer.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });

        // Open the mixer via the bottom dock toggle.
        const mixerToggle = page.getByRole('button', { name: 'Toggle bottom dock' }).first();
        await mixerToggle.click();
        await page.waitForTimeout(500);
    });

    test('mute button toggles data-active via test ID', async ({ page }) => {
        const mute = page.locator('[data-testid^="channel-mute-"]').first();
        await mute.waitFor({ state: 'visible', timeout: 10_000 });

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });

    test('solo button toggles data-active via test ID', async ({ page }) => {
        const solo = page.locator('[data-testid^="channel-solo-"]').first();
        await solo.waitFor({ state: 'visible', timeout: 10_000 });

        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'true');

        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'false');
    });

    test('pan knob wrapper is present and slider defaults to 0 (center)', async ({ page }) => {
        const pan = page.locator('[data-testid^="channel-pan-"]').first();
        await expect(pan).toBeVisible({ timeout: 10_000 });

        const slider = pan.getByRole('slider');
        await expect(slider).toBeVisible();

        const value = await slider.getAttribute('aria-valuenow');
        expect(value).toBe('0');
    });

    test('pan knob responds to keyboard increment', async ({ page }) => {
        const pan = page.locator('[data-testid^="channel-pan-"]').first();
        await pan.waitFor({ state: 'visible', timeout: 10_000 });

        const slider = pan.getByRole('slider');
        await slider.focus();
        await page.keyboard.press('ArrowRight');

        const value = await slider.getAttribute('aria-valuenow');
        expect(Number(value)).toBeGreaterThan(0);
    });

    test('muting one channel then unmuting shows data-active cycling true→false', async ({ page }) => {
        const mute = page.locator('[data-testid^="channel-mute-"]').first();
        await mute.waitFor({ state: 'visible', timeout: 10_000 });

        // Default: not muted.
        await expect(mute).toHaveAttribute('data-active', 'false');

        // Mute.
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        // Unmute.
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });
});
