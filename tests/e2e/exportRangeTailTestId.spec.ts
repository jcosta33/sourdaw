import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openExportDialog(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    await expect(page.getByRole('dialog').filter({ hasText: /The Bakery/i })).toBeVisible({ timeout: 10_000 });
}

test.describe('Export range & tail — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('render range shows Whole project option as default', async ({ page }) => {
        await openExportDialog(page);

        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        await expect(radiogroup).toBeVisible({ timeout: 5000 });

        // The "Whole project" radio should be checked by default.
        const wholeProject = radiogroup.getByLabel('Whole project');
        await expect(wholeProject).toBeChecked();
    });

    test('loop region radio is present but disabled without a loop', async ({ page }) => {
        await openExportDialog(page);

        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        const loopRegion = radiogroup.getByLabel(/Loop region/i);
        await expect(loopRegion).toBeVisible();

        // In a new project with no loop set, it should be disabled.
        const isDisabled = await loopRegion.isDisabled();
        expect(isDisabled).toBe(true);
    });

    test('marquee selection radio is present but disabled without a selection', async ({ page }) => {
        await openExportDialog(page);

        const radiogroup = page.getByRole('radiogroup', { name: 'Render range' });
        const marquee = radiogroup.getByLabel(/Marquee selection/i);
        await expect(marquee).toBeVisible();

        const isDisabled = await marquee.isDisabled();
        expect(isDisabled).toBe(true);
    });

    test('tail seconds input is present in the dialog', async ({ page }) => {
        await openExportDialog(page);

        // The tail input may be disabled if auto-detect is on — just verify it's attached.
        const tail = page.locator('[aria-label="Tail seconds"]');
        await expect(tail).toBeAttached({ timeout: 5000 });
    });

    test('auto-detect tail checkbox is present', async ({ page }) => {
        await openExportDialog(page);

        // The auto-detect checkbox should be visible.
        const autoDetect = page.getByLabel(/Auto-detect/i);
        await expect(autoDetect).toBeVisible({ timeout: 5000 });
    });
});
