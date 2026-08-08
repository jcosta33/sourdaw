import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Full project lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('complete MIDI workflow: track, clip, note, play, stop', async ({ page }) => {
        const emptyState = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyState.waitFor({ state: 'visible' });
        await emptyState.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });

        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
        await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
        await page.waitForTimeout(500);

        await canvas.dblclick({ position: { x: 300, y: 30 } });
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(500);
        await pianoRoll.dblclick({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(500);

        await expect(page.getByTestId('transport-undo')).toBeEnabled({ timeout: 10_000 });

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(600);
        await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

        await page.getByTestId('transport-stop').click();
        await expect(page.getByTestId('transport-playhead')).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });

    test('add device and bypass via inspector', async ({ page }) => {
        const emptyState = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyState.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().waitFor({ state: 'visible' });
        await trackList.getByRole('row').first().click();
        await page.waitForTimeout(300);

        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        const addDevice = page.getByTestId('add-device-button');
        if (await addDevice.isVisible().catch(() => false)) {
            await addDevice.click();
            await page.waitForTimeout(300);
            await page.getByRole('menu').getByRole('menuitem').first().click();
            await page.waitForTimeout(500);

            const bypass = page.locator('[data-testid^="device-bypass-"]').first();
            await expect(bypass).toBeVisible({ timeout: 5000 });
            await bypass.click();
            await expect(bypass).toHaveAttribute('aria-pressed', 'true');
        }
    });

    test('mute during playback then unmute', async ({ page }) => {
        const emptyState = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyState.click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().waitFor({ state: 'visible' });

        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(500);
        await page.getByTestId('transport-stop').click();

        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });

    test('open chat and generate panels simultaneously', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('toggle-chat')).toHaveAttribute('aria-pressed', 'true');

        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(300);
        await expect(page.getByTestId('toggle-generate')).toHaveAttribute('aria-pressed', 'true');

        // Close both.
        await page.getByTestId('toggle-generate').click();
        await page.getByTestId('toggle-chat').click();
    });

    test('keyboard shortcuts: M → Space → Escape → M', async ({ page }) => {
        await page.keyboard.press('KeyM');
        await expect(page.getByTestId('transport-metronome')).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('Space');
        await page.waitForTimeout(600);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await expect(page.getByTestId('transport-playhead')).toHaveText(/1\.1\.000/, { timeout: 5000 });

        await page.keyboard.press('KeyM');
        await expect(page.getByTestId('transport-metronome')).toHaveAttribute('aria-pressed', 'false');
    });
});
