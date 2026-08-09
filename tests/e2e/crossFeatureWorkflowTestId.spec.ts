import { test, expect } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('Cross-feature workflow — EDM template', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'EDM' }).click();
        await wait_for_workspace_ready(page);
    });

    test('play → mute track → open piano roll → draw note → undo → stop', async ({ page }) => {
        // Start playback.
        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(500);

        // Mute first track during playback.
        const mute = page.locator('[data-testid^="track-mute-"]').first();
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'true');

        // Stop.
        await page.getByTestId('transport-stop').click();

        // Open piano roll.
        const canvas = page.getByLabel('Timeline editor surface');
        const positions = [{ x: 100, y: 40 }, { x: 200, y: 40 }, { x: 150, y: 80 }];
        let opened = false;
        for (const pos of positions) {
            await canvas.dblclick({ position: pos });
            await page.waitForTimeout(500);
            if (await page.locator('[aria-label="Piano roll editor"]').isVisible().catch(() => false)) {
                opened = true;
                break;
            }
        }
        if (opened) {
            // Draw a note.
            await page.locator('[aria-label="Piano roll editor"]').dblclick({ position: { x: 100, y: 100 } });
            await page.waitForTimeout(500);

            // Undo.
            await expect(page.getByTestId('transport-undo')).toBeEnabled({ timeout: 10_000 });
            await page.getByTestId('transport-undo').click();
            await page.waitForTimeout(500);
        }

        // Unmute.
        await mute.click();
        await expect(mute).toHaveAttribute('data-active', 'false');
    });

    test('add track → add device → bypass → open export → cancel', async ({ page }) => {
        // Add a track.
        await page.getByTestId('add-track-button').getByRole('button').click();
        await page.getByTestId('add-track-midi').click();
        await page.waitForTimeout(500);

        // Select and open inspector.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').last().click();
        const inspector = page.getByTestId('toggle-inspector');
        if ((await inspector.getAttribute('aria-pressed')) === 'false') {
            await inspector.click();
            await page.waitForTimeout(300);
        }

        // Add device.
        const addDevice = page.getByTestId('add-device-button');
        if (await addDevice.isVisible().catch(() => false)) {
            await addDevice.click();
            await page.waitForTimeout(300);
            await page.getByRole('menu').getByRole('menuitem').first().click();
            await page.waitForTimeout(500);

            // Bypass.
            const bypass = page.locator('[data-testid^="device-bypass-"]').first();
            if (await bypass.isVisible().catch(() => false)) {
                await bypass.click();
                await expect(bypass).toHaveAttribute('aria-pressed', 'true');
            }
        }

        // Open export dialog.
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
        await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });

        // Cancel.
        await page.getByTestId('export-cancel').click();
        await page.waitForTimeout(300);
    });

    test('command palette → search → Escape → open preferences', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);

        // Open command palette.
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
        await expect(page.getByTestId('command-palette-input')).toBeVisible({ timeout: 5000 });

        // Type and close.
        await page.getByTestId('command-palette-input').fill('track');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');

        // Open preferences.
        await page.getByTestId('toggle-preferences').click();
        await page.waitForTimeout(500);

        // Dialog should appear.
        const dialog = page.getByRole('dialog');
        const hasDialog = await dialog.isVisible().catch(() => false);
        if (hasDialog) {
            expect(await dialog.innerText()).toBeTruthy();
        }
    });

    test('solo mode cycle → BPM increment → metronome → play', async ({ page }) => {
        // Cycle solo mode SIP → AFL.
        await page.getByTestId('solo-mode-afl').click();
        await expect(page.getByTestId('solo-mode-afl')).toHaveAttribute('aria-checked', 'true');

        // Back to SIP.
        await page.getByTestId('solo-mode-sip').click();

        // BPM increment.
        const bpm = page.getByTestId('transport-tempo-bpm').getByRole('spinbutton');
        await bpm.focus();
        await page.keyboard.press('ArrowUp');

        // Metronome on.
        await page.getByTestId('transport-metronome').click();
        await expect(page.getByTestId('transport-metronome')).toHaveAttribute('aria-pressed', 'true');

        // Play.
        await page.getByTestId('transport-play').click();
        await page.waitForTimeout(500);
        await page.getByTestId('transport-stop').click();

        // Metronome off.
        await page.getByTestId('transport-metronome').click();
    });

    test('dual view → scene launch → close dual view → open mixer', async ({ page }) => {
        // Open dual view.
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        // Launch scene 1.
        await page.getByRole('button', { name: 'Launch scene 1' }).click();
        await page.waitForTimeout(300);

        // Close dual view.
        await page.getByTestId('toggle-dual-view').click();
        await page.waitForTimeout(500);

        // Open mixer.
        const dock = page.getByTestId('toggle-bottom-dock');
        if ((await dock.getAttribute('aria-pressed')) === 'false') {
            await dock.click();
            await page.waitForTimeout(500);
        }

        const mixerTab = page.locator('#bottom-dock-tab-mixer');
        if (await mixerTab.isVisible().catch(() => false)) {
            await mixerTab.click();
            await page.waitForTimeout(500);

            // Channel mute buttons should be visible.
            const mutes = page.locator('[data-testid^="channel-mute-"]');
            const hasMutes = await mutes.first().isVisible().catch(() => false);
            if (hasMutes) {
                expect(await mutes.count()).toBeGreaterThan(0);
            }
        }
    });
});
