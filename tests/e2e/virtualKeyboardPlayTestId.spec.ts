import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Virtual keyboard interaction', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('virtual keyboard opens via test ID', async ({ page }) => {
        const vk = page.getByTestId('toggle-virtual-keyboard');
        await vk.click();
        await expect(vk).toHaveAttribute('aria-pressed', 'true');

        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible({ timeout: 5000 });
    });

    test('virtual keyboard has tabIndex 0 for focus', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        const tabIndex = await keyboard.getAttribute('tabindex');
        expect(tabIndex).toBe('0');
    });

    test('virtual keyboard close button works', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        const closeBtn = page.getByRole('button', { name: 'Close virtual keyboard' });
        await closeBtn.click();
        await page.waitForTimeout(300);

        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).not.toBeVisible();
    });

    test('VK toggle can be opened and closed repeatedly', async ({ page }) => {
        const vk = page.getByTestId('toggle-virtual-keyboard');

        for (let i = 0; i < 3; i += 1) {
            await vk.click();
            await expect(vk).toHaveAttribute('aria-pressed', 'true');
            await page.waitForTimeout(200);
            await vk.click();
            await expect(vk).toHaveAttribute('aria-pressed', 'false');
            await page.waitForTimeout(200);
        }
    });

    test('VK coexists with transport and track list', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        await expect(page.getByTestId('transport-play')).toBeVisible();
        await expect(page.getByTestId('transport-stop')).toBeVisible();
        
    });
});
