import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Command palette — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('opening command palette via Cmd+K shows input via test ID', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible({ timeout: 5000 });
    });

    test('typing in the command palette filters results', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible({ timeout: 5000 });

        // Type a query — results should appear.
        await input.fill('track');
        await page.waitForTimeout(300);

        // There should be at least one option in the listbox.
        const options = page.getByRole('option');
        const count = await options.count();
        expect(count).toBeGreaterThan(0);
    });

    test('arrow keys navigate the results list', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await input.fill('track');
        await page.waitForTimeout(300);

        const options = page.getByRole('option');
        const count = await options.count();
        expect(count).toBeGreaterThan(0);

        // First option should be selected by default.
        await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

        // Arrow down — second option selected.
        await input.press('ArrowDown');
        await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
        await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
    });

    test('Escape closes the command palette', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        await expect(input).not.toBeVisible();
    });

    test('clearing the search shows all commands', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const input = page.getByTestId('command-palette-input');
        await input.fill('track');
        await page.waitForTimeout(200);
        const filteredCount = await page.getByRole('option').count();

        await input.fill('');
        await page.waitForTimeout(200);
        const allCount = await page.getByRole('option').count();

        // Clearing the filter should show more (or equal) results.
        expect(allCount).toBeGreaterThanOrEqual(filteredCount);
    });
});
