import { expect, test } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test('exports the complete Mycelium Ascendant mix as a stereo WAV', async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    const deviceWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            consoleErrors.push(text);
        }
        if (
            message.type() === 'warning' &&
            (text.includes('failed to load') || text.toLowerCase().includes('missing asset'))
        ) {
            deviceWarnings.push(text);
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
    await page.addInitScript(() => {
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
    await setupWorkspace(page);

    const launchScreen = page.getByLabel('Sourdaw — start a project');
    await expect(launchScreen).toBeVisible();
    await page.locator('#launch-demo-project').click();
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible();
    await card.click();
    await wait_for_workspace_ready(page);
    await expect(page.getByRole('button', { name: 'Mycelium Ascendant' })).toBeVisible();

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /WAV/i })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('checkbox', { name: /MP3/i })).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByRole('checkbox', { name: /FLAC/i })).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByRole('radio', { name: 'Whole project' })).toBeChecked();
    await expect(dialog.getByLabel('Tail seconds')).toHaveValue('2');

    const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
    await dialog.getByRole('button', { name: 'Start Baking' }).click();
    const download = await downloadPromise;
    await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible({ timeout: 300_000 });

    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
    expect(consoleErrors).toEqual([]);
    expect(deviceWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
});
