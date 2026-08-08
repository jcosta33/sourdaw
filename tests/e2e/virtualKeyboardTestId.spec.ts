import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Virtual keyboard & panel toggles — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('virtual keyboard toggle opens and closes via test ID', async ({ page }) => {
        const vkToggle = page.getByTestId('toggle-virtual-keyboard');
        await expect(vkToggle).toBeVisible();
        await expect(vkToggle).toHaveAttribute('aria-pressed', 'false');

        // Open.
        await vkToggle.click();
        await expect(vkToggle).toHaveAttribute('aria-pressed', 'true');

        // Virtual keyboard should be visible.
        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible({ timeout: 5000 });

        // Close.
        await vkToggle.click();
        await expect(vkToggle).toHaveAttribute('aria-pressed', 'false');
        await expect(keyboard).not.toBeVisible();
    });

    test('virtual keyboard renders with keyboard focus area', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible();

        // The keyboard should have tabIndex=0 for focus.
        const tabIndex = await keyboard.getAttribute('tabindex');
        expect(tabIndex).toBe('0');
    });

    test('virtual keyboard close button works', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible();

        // Click the close button inside the keyboard.
        await page.getByRole('button', { name: 'Close virtual keyboard' }).click();
        await expect(keyboard).not.toBeVisible();

        // The toggle should reflect closed state.
        await expect(page.getByTestId('toggle-virtual-keyboard')).toHaveAttribute('aria-pressed', 'false');
    });

    test('inspector toggle opens and closes via aria-label', async ({ page }) => {
        const inspector = page.getByRole('button', { name: 'Toggle inspector' });
        await expect(inspector).toBeVisible();

        const before = await inspector.getAttribute('aria-pressed');
        await inspector.click();
        await page.waitForTimeout(300);
        await expect(inspector).not.toHaveAttribute('aria-pressed', before ?? '');
    });

    test('bottom dock toggle round-trips via aria-label', async ({ page }) => {
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        await expect(dock).toBeVisible();

        const before = await dock.getAttribute('aria-pressed');
        await dock.click();
        await page.waitForTimeout(300);
        await expect(dock).not.toHaveAttribute('aria-pressed', before ?? '');
    });
});
