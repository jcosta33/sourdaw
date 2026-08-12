import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// Notification toast dismiss. The corrupt-import specs (#1662, #1665) assert the
// toast APPEARS (role="alert" count 0→1) but never test the dismiss button
// clears it. This asserts: trigger a toast, click Dismiss, toast disappears.
test.describe('Notification toast — dismiss clears the alert', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Dismiss button removes the toast alert', async ({ page }) => {
        // Trigger a toast by importing a corrupt MIDI file.
        await page.keyboard.press('Control+K');
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import MIDI/i }).click();
        const fileChooser = await chooser;
        await fileChooser.setFiles({
            name: 'corrupt.mid',
            mimeType: 'audio/midi',
            buffer: Buffer.from('not midi data'.repeat(8)),
        });

        // Toast appears.
        const toast = page.getByRole('alert');
        await expect(toast).toBeVisible({ timeout: 10_000 });

        // Click Dismiss — the toast disappears.
        await page.getByRole('button', { name: 'Dismiss notification' }).click();
        await expect(toast).toHaveCount(0);
    });
});
