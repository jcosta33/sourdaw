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

        const keyboard = page.getByRole('region', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible({ timeout: 5000 });
    });

    test('open virtual keyboard swallows app shortcuts from unmodified keys', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        const keyboard = page.getByRole('region', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible();

        // Shift+Slash opens the shortcut cheat sheet when the keyboard is closed.
        await page.keyboard.press('Shift+Slash');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(keyboard).not.toBeVisible();
        await page.keyboard.press('Shift+Slash');
        await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeVisible();
    });

    test('virtual keyboard close button works', async ({ page }) => {
        await page.getByTestId('toggle-virtual-keyboard').click();
        await page.waitForTimeout(500);

        const closeBtn = page.getByRole('button', { name: 'Close virtual keyboard' });
        await closeBtn.click();
        await page.waitForTimeout(300);

        const keyboard = page.getByRole('region', { name: 'Virtual Piano Keyboard' });
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
