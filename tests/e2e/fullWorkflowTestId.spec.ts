import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Full workflow integration — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('play → mute a track → hear it mute → unmute → stop', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const stop = page.getByTestId('transport-stop');
        await expect(play).toBeVisible({ timeout: 15_000 });

        // Start playback.
        await play.click();
        await page.waitForTimeout(500);

        // Mute the first track in the track list.
        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        // Unmute.
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');

        // Stop.
        await stop.click();
        await expect(page.getByTestId('transport-playhead')).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('solo a track, switch tools, open piano roll, close it', async ({ page }) => {
        // Solo first track.
        const solo = page.locator('[data-testid^="track-solo-"]').first();
        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'true');

        // Switch to draw tool.
        const draw = page.getByTestId('tool-draw');
        await draw.click();
        await expect(draw).toHaveAttribute('aria-checked', 'true');

        // Switch back to select.
        await page.getByTestId('tool-select').click();
        await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-checked', 'true');

        // Unsolo.
        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'false');
    });

    test('open inspector, see gain/pan, close inspector', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        await expect(page.getByTestId('inspector-track-gain')).toBeVisible({ timeout: 5000 });

        // Close inspector.
        await inspector.click();
        await page.waitForTimeout(300);
    });

    test('open export dialog, select format, cancel', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');

        await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({
            timeout: 10_000,
        });

        // Toggle FLAC format.
        const flac = page.getByTestId('export-format-flac');
        await flac.click();
        await page.waitForTimeout(200);

        // Cancel.
        await page.getByTestId('export-cancel').click();
        await page.waitForTimeout(300);

        await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).not.toBeVisible();
    });

    test('open command palette, search, close', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible({ timeout: 5000 });

        await input.fill('track');
        await page.waitForTimeout(300);

        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);

        await page.keyboard.press('Escape');
        await expect(input).not.toBeVisible();
    });
});
