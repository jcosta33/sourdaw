import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('EDM full cycle — playback, mixer, transport, tools', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('play with metronome, then stop', async ({ page }) => {
        await page.getByTestId('transport-metronome').click();
        await expect(page.getByTestId('transport-metronome')).toHaveAttribute('aria-pressed', 'true');

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(800);

        const playhead = page.getByTestId('transport-playhead');
        expect((await playhead.innerText()).trim()).not.toMatch(/1\.1\.000/);

        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });

        await page.getByTestId('transport-metronome').click();
    });

    test('solo a track shows data-active in track header', async ({ page }) => {
        const solo = page.locator('[data-testid^="track-solo-"]').first();
        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'true');
        await solo.click();
        await expect(solo).toHaveAttribute('data-active', 'false');
    });

    test('switch all 6 editing tools in sequence', async ({ page }) => {
        for (const tool of ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee']) {
            await page.getByTestId(`tool-${tool}`).click();
            await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-checked', 'true');
        }
        // Back to select.
        await page.getByTestId('tool-select').click();
    });

    test('arm a track, then disarm', async ({ page }) => {
        const arm = page.locator('[data-testid^="track-arm-"]').first();
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'true');
        await arm.click();
        await expect(arm).toHaveAttribute('data-active', 'false');
    });

    test('ripple editing toggle round-trip', async ({ page }) => {
        const ripple = page.getByTestId('tool-ripple');
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'true');
        await ripple.click();
        await expect(ripple).toHaveAttribute('aria-pressed', 'false');
    });
});
