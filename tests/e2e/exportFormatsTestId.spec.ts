import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openExportDialog(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Export formats — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('all 3 format checkboxes are present via test IDs', async ({ page }) => {
        await openExportDialog(page);

        await expect(page.getByTestId('export-format-wav')).toBeVisible();
        await expect(page.getByTestId('export-format-mp3')).toBeVisible();
        await expect(page.getByTestId('export-format-flac')).toBeVisible();
    });

    test('clicking a format toggles aria-checked via test ID', async ({ page }) => {
        await openExportDialog(page);

        // FLAC is likely unchecked by default.
        const flac = page.getByTestId('export-format-flac');
        await expect(flac).toHaveAttribute('aria-checked', 'false');

        await flac.click();
        await page.waitForTimeout(200);
        await expect(flac).toHaveAttribute('aria-checked', 'true');

        await flac.click();
        await page.waitForTimeout(200);
        await expect(flac).toHaveAttribute('aria-checked', 'false');
    });

    test('multiple formats can be selected simultaneously', async ({ page }) => {
        await openExportDialog(page);

        const wav = page.getByTestId('export-format-wav');
        const mp3 = page.getByTestId('export-format-mp3');

        // Select both.
        if ((await wav.getAttribute('aria-checked')) === 'false') {
            await wav.click();
        }
        if ((await mp3.getAttribute('aria-checked')) === 'false') {
            await mp3.click();
        }
        await page.waitForTimeout(200);

        await expect(wav).toHaveAttribute('aria-checked', 'true');
        await expect(mp3).toHaveAttribute('aria-checked', 'true');
    });

    test('format buttons show their label text', async ({ page }) => {
        await openExportDialog(page);

        const wav = page.getByTestId('export-format-wav');
        const wavText = (await wav.innerText()).trim();
        expect(wavText).toContain('WAV');

        const flac = page.getByTestId('export-format-flac');
        const flacText = (await flac.innerText()).trim();
        expect(flacText).toContain('FLAC');
    });
});
