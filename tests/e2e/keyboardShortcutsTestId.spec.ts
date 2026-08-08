import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Keyboard shortcuts — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('Space toggles play/pause via keyboard', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        await expect(play).toBeVisible({ timeout: 15_000 });

        // Press Space to play.
        await page.keyboard.press('Space');
        await page.waitForTimeout(600);

        // Pause button should be visible.
        const pause = page.getByRole('button', { name: 'Pause', exact: true });
        await expect(pause).toBeVisible({ timeout: 5000 });

        // Press Space again to pause.
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);

        // Play should be visible again.
        await expect(play).toBeVisible();
    });

    test('Escape stops playback and resets playhead', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        await expect(play).toBeVisible({ timeout: 15_000 });

        // Play.
        await page.keyboard.press('Space');
        await page.waitForTimeout(600);

        // Escape to stop.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Playhead returns to start.
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('M toggles metronome via keyboard', async ({ page }) => {
        const metronome = page.getByTestId('transport-metronome');
        await expect(metronome).toBeVisible({ timeout: 15_000 });
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await page.keyboard.press('KeyM');
        await page.waitForTimeout(300);
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('KeyM');
        await page.waitForTimeout(300);
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('L toggles loop via keyboard', async ({ page }) => {
        const loop = page.getByTestId('transport-loop');
        await expect(loop).toBeVisible({ timeout: 15_000 });

        const before = await loop.getAttribute('aria-pressed');
        await page.keyboard.press('KeyL');
        await page.waitForTimeout(300);
        await expect(loop).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('Cmd+K opens command palette via keyboard', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible({ timeout: 5000 });
    });
});
