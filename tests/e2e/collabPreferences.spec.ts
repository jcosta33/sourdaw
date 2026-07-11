import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Collaboration & Preferences', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can open the collaboration panel', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle collaboration panel' }).click();
        await expect(page.getByRole('dialog', { name: 'Collaborate' })).toBeVisible({ timeout: 5000 });
    });

    test('Collaboration panel is interactive', async ({ page }) => {
        await page.getByRole('button', { name: 'Toggle collaboration panel' }).click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Can close the collaboration panel', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel' });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await toggle.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
    });

    test('Can open and close the preferences dialog', async ({ page }) => {
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        await expect(page.getByRole('dialog').filter({ hasText: /Preferences/i })).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog').filter({ hasText: /Preferences/i })).toBeHidden();
    });

    test('Preferences dialog has interactive elements', async ({ page }) => {
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Ableton Link toggle is present', async ({ page }) => {
        const link = page.getByRole('button', { name: /Ableton Link/i });
        await expect(link).toBeVisible();
    });
});
