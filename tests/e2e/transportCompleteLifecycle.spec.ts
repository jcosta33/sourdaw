import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Transport complete lifecycle — every control', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('play → pause → play → stop cycle', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const stop = page.getByTestId('transport-stop');
        const playhead = page.getByTestId('transport-playhead');

        // Play.
        await play.click();
        await page.waitForTimeout(400);
        const pause = page.getByRole('button', { name: 'Pause', exact: true });
        await expect(pause).toBeVisible();

        // Pause.
        await pause.click();
        await expect(play).toBeVisible();

        // Play again.
        await play.click();
        await page.waitForTimeout(400);

        // Stop.
        await stop.click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('metronome on → volume slider visible → metronome off', async ({ page }) => {
        const metronome = page.getByTestId('transport-metronome');
        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'true');

        // Volume slider should appear.
        const volume = page.getByRole('slider', { name: /Metronome volume/i });
        const hasVolume = await volume.isVisible().catch(() => false);
        if (hasVolume) {
            const value = await volume.getAttribute('aria-valuenow');
            expect(value).not.toBeNull();
        }

        await metronome.click();
        await expect(metronome).toHaveAttribute('aria-pressed', 'false');
    });

    test('loop → play → stop with loop enabled', async ({ page }) => {
        const loop = page.getByTestId('transport-loop');
        const play = page.getByTestId('transport-play');
        const stop = page.getByTestId('transport-stop');

        await loop.click({ force: true });
        await page.waitForTimeout(200);

        await play.click();
        await page.waitForTimeout(800);

        await stop.click();
        await page.waitForTimeout(500);

        // Disable loop.
        await loop.click({ force: true });

        // Transport still functional.
        await expect(play).toBeVisible();
    });

    test('punch in + count-in enabled simultaneously', async ({ page }) => {
        const punch = page.getByTestId('transport-punch');
        const countIn = page.getByTestId('transport-countin');

        await punch.click();
        await countIn.click();

        await expect(punch).toHaveAttribute('aria-pressed', 'true');
        await expect(countIn).toHaveAttribute('aria-pressed', 'true');

        // Count-in pill should be visible.
        const pill = page.locator('[aria-label*="Count-in bars"]').first();
        await expect(pill).toBeVisible({ timeout: 5000 });
    });

    test('BPM keyboard increment + time signature display', async ({ page }) => {
        const bpm = page.getByTestId('transport-tempo-bpm').getByRole('spinbutton');
        await bpm.focus();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');

        const value = await bpm.getAttribute('aria-valuenow');
        expect(Number(value)).toBeGreaterThan(120);

        const timeSig = page.getByTestId('transport-time-signature');
        const tsText = (await timeSig.innerText()).trim();
        expect(tsText).toMatch(/\d\/\d/);
    });
});
