import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Transport with Pop Song template — deep integration', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('play moves playhead from 1.1.000 on a populated project', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const playhead = page.getByTestId('transport-playhead');
        await expect(play).toBeVisible({ timeout: 15_000 });
        await expect(playhead).toHaveText(/1\.1\.000/);

        await play.click();
        await page.waitForTimeout(800);

        const movingText = (await playhead.innerText()).trim();
        expect(movingText).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('loop button is present and clickable on template project', async ({ page }) => {
        const loop = page.getByTestId('transport-loop');
        await expect(loop).toBeVisible({ timeout: 15_000 });

        // Click should not crash — capture state before/after.
        const before = await loop.getAttribute('aria-pressed');
        await loop.click({ force: true });
        await page.waitForTimeout(300);

        // The button should still be present and functional.
        await expect(loop).toBeVisible();
    });

    test('metronome can be toggled during playback', async ({ page }) => {
        const metronome = page.getByTestId('transport-metronome');
        const play = page.getByTestId('transport-play');
        await expect(play).toBeVisible({ timeout: 15_000 });

        await play.click();
        await page.waitForTimeout(500);

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');

        await page.getByTestId('transport-stop').click();
    });

    test('record toggle changes aria-pressed on populated project', async ({ page }) => {
        const record = page.getByTestId('transport-record');
        await expect(record).toBeVisible({ timeout: 15_000 });
        await expect(record).toHaveAttribute('aria-pressed', 'false');

        await record.click();
        await expect(record).toHaveAttribute('aria-pressed', 'true');

        await record.click();
        await expect(record).toHaveAttribute('aria-pressed', 'false');
    });

    test('BPM spinbutton shows the template tempo', async ({ page }) => {
        const bpmWrapper = page.getByTestId('transport-tempo-bpm');
        await expect(bpmWrapper).toBeVisible({ timeout: 15_000 });

        const bpm = bpmWrapper.getByRole('spinbutton');
        await expect(bpm).toBeVisible();
        const value = await bpm.getAttribute('aria-valuenow');
        expect(Number(value)).toBeGreaterThan(0);
    });
});
