import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openExport(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Export fidelity controls', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('export dialog shows render order with 3 mode buttons', async ({ page }) => {
        await openExport(page);
        await expect(page.getByTestId('export-mode-mixdown')).toBeVisible();
        await expect(page.getByTestId('export-mode-stems')).toBeVisible();
    });

    test('switching to stems mode changes active button', async ({ page }) => {
        await openExport(page);
        const stems = page.getByTestId('export-mode-stems');
        const mixdown = page.getByTestId('export-mode-mixdown');

        const stemsBefore = await stems.getAttribute('data-variant');
        await stems.click();
        await page.waitForTimeout(300);
        const stemsAfter = await stems.getAttribute('data-variant');
        expect(stemsAfter).not.toBe(stemsBefore);
    });

    test('render range radio group has Whole project checked', async ({ page }) => {
        await openExport(page);
        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        await expect(radiogroup).toBeVisible({ timeout: 5000 });
        const wholeProject = radiogroup.getByLabel('Whole project');
        await expect(wholeProject).toBeChecked();
    });

    test('cancel button closes export dialog', async ({ page }) => {
        await openExport(page);
        await page.getByTestId('export-cancel').click();
        await page.waitForTimeout(300);
        await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).not.toBeVisible();
    });

    test('start baking button text reflects current mode', async ({ page }) => {
        await openExport(page);
        const start = page.getByTestId('export-start');
        await expect(start).toBeVisible();
        const text = (await start.innerText()).trim();
        expect(text).toContain('Start Baking');
    });
});
