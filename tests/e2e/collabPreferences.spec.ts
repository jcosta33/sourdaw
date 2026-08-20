import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Collaboration & Preferences', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Collaboration panel opens with invite mechanism', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel' });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByRole('button').first()).toBeVisible({ timeout: 5000 });
    });

    test('Collaboration panel can be closed via toggle', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle collaboration panel' });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await toggle.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
    });

    test('Preferences dialog opens with interactive settings controls', async ({ page }) => {
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByRole('button').first()).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
    });

    test('Preferences dialog can be closed with Escape', async ({ page }) => {
        await page.getByRole('button', { name: 'Open Preferences' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Preferences/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: 5000 });
    });
});
