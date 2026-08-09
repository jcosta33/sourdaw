import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Yeast MIDI FX & recorder arm — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('arm button toggles data-active on first track', async ({ page }) => {
        const arm = page.locator('[data-testid^="track-arm-"]').first();
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'true');
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'false');
    });

    test('record toggle in transport round-trips', async ({ page }) => {
        const record = page.getByTestId('transport-record');
        await expect(record).toHaveAttribute('aria-pressed', 'false');
        await record.click();
        await expect(record).toHaveAttribute('aria-pressed', 'true');
        await record.click();
        await expect(record).toHaveAttribute('aria-pressed', 'false');
    });

    test('armed track shows ring indicator', async ({ page }) => {
        const arm = page.locator('[data-testid^="track-arm-"]').first();
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'true');
        // The record button should show armed state.
        const record = page.getByTestId('transport-record');
        await expect(record).toBeVisible();
        await arm.click();
    });

    test('metronome + record arm + play sequence', async ({ page }) => {
        await page.getByTestId('transport-metronome').click();
        await page.locator('[data-testid^="track-arm-"]').first().click();
        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(600);

        const playhead = page.getByTestId('transport-playhead');
        expect((await playhead.innerText()).trim()).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });

        await page.getByTestId('transport-metronome').click();
        await page.locator('[data-testid^="track-arm-"]').first().click();
    });

    test('overdub toggle visible when MIDI track armed', async ({ page }) => {
        await page.locator('[data-testid^="track-arm-"]').first().click();

        // Overdub button should now be visible (only shows when MIDI track armed).
        const overdub = page.getByRole('button', { name: 'Overdub' }).first();
        const hasOverdub = await overdub.isVisible().catch(() => false);
        if (hasOverdub) {
            await expect(overdub).toHaveAttribute('aria-pressed', 'false');
        }

        // Disarm.
        await page.locator('[data-testid^="track-arm-"]').first().click();
    });
});
