import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Export & Bouncing', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can open the export dialog via shortcut and toggle formats', async ({ page }) => {
        // Press 'Cmd+Shift+E' / 'Ctrl+Shift+E' to open the Export Dialog directly
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');

        // The Export dialog should appear. Sourdaw's export dialog has the title 'The Bakery'.
        // We look for a dialog that contains this text.
        const exportDialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await expect(exportDialog).toBeVisible();

        // Find format checkboxes (WAV, MP3, FLAC are rendered with role='checkbox' in Sourdaw)
        const wavButton = exportDialog.getByRole('checkbox', { name: /WAV/i });
        const mp3Button = exportDialog.getByRole('checkbox', { name: /MP3/i });
        const flacButton = exportDialog.getByRole('checkbox', { name: /FLAC/i });

        await expect(wavButton).toBeVisible();
        await expect(mp3Button).toBeVisible();
        await expect(flacButton).toBeVisible();

        // Toggle MP3 format on
        await mp3Button.click();

        // There should be a "Start Baking" button
        const exportButton = exportDialog.getByRole('button', { name: /Start Baking/i });
        await expect(exportButton).toBeVisible();

        // Close the dialog using the Escape key to bypass viewport/scroll constraints
        await page.keyboard.press('Escape');

        // Verify dialog is closed
        await expect(exportDialog).not.toBeVisible();
    });
});
