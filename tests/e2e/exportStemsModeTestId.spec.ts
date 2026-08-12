import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

async function openBakery(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Export stems mode', () => {
    test('stems mode is mutually exclusive with mixdown', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await openBakery(page);

        const mixdown = page.getByTestId('export-mode-mixdown');
        const stems = page.getByTestId('export-mode-stems');

        // Mixdown is the default active mode; stems starts inactive (outline).
        await expect(mixdown).not.toHaveAttribute('data-variant', 'outline');
        await expect(stems).toHaveAttribute('data-variant', 'outline');

        await stems.click();

        // The existing fidelity suite only proves the stems button itself changed
        // variant; this proves the mode group is a single-choice toggle — mixdown
        // deactivates when stems becomes active.
        await expect(stems).not.toHaveAttribute('data-variant', 'outline');
        await expect(mixdown).toHaveAttribute('data-variant', 'outline');
    });

    test('stems mode bakes a multi-stem ZIP instead of a single mixdown file', async ({ page }) => {
        test.setTimeout(240_000);
        // Strip the File System Access API so the dialog falls back to its
        // <a download> path, which Playwright captures as a `download` event.
        // Registered before setupWorkspace's `page.goto('/')` so it applies on load.
        await page.addInitScript(() => {
            Reflect.deleteProperty(window, 'showSaveFilePicker');
        });
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        await openBakery(page);
        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });

        await dialog.getByTestId('export-mode-stems').click();
        await expect(dialog.getByTestId('export-mode-stems')).not.toHaveAttribute('data-variant', 'outline');

        const downloadPromise = page.waitForEvent('download', { timeout: 220_000 });
        await dialog.getByRole('button', { name: 'Start Baking' }).click();
        const download = await downloadPromise;

        await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible({ timeout: 220_000 });
        expect(await download.failure()).toBeNull();

        // The observable that proves stems mode changed the export path: a zipped
        // per-track set named Sourdaw_Slices_<ts>.zip — never the single
        // Sourdaw_Bake_<ts>.wav that mixdown produces. (ExportDialog forces a zip
        // for stems even when only one stem renders.) "Close Bakery" only appears
        // once progress hits 100%, so its visibility confirms the bake completed.
        expect(download.suggestedFilename()).toMatch(/^Sourdaw_Slices_\d+\.zip$/);
    });
});
