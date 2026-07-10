import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Virtual Keyboard', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.getByRole('button', { name: 'Toggle virtual keyboard' }).click();
    });

    test('Virtual keyboard is visible with piano keys', async ({ page }) => {
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboard).toBeVisible();
        await expect(keyboard.getByRole('button', { name: /C4/i })).toBeVisible();
    });

    test('Can shift octave up', async ({ page }) => {
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboard.getByRole('button', { name: /C4/i })).toBeVisible();

        await page.getByRole('button', { name: 'Octave up' }).click();

        await expect(keyboard.getByRole('button', { name: /C5/i })).toBeVisible();
    });

    test('Can shift octave down', async ({ page }) => {
        await page.getByRole('button', { name: 'Octave down' }).click();
        const keyboard = page.getByRole('application', { name: /Virtual Piano Keyboard/i });
        await expect(keyboard.getByRole('button', { name: /C3/i })).toBeVisible();
    });

    test('Note velocity slider is present', async ({ page }) => {
        await expect(page.getByRole('slider', { name: 'Note velocity' })).toBeVisible();
    });

    test('Can close the virtual keyboard', async ({ page }) => {
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeVisible();
        await page.getByRole('button', { name: 'Close virtual keyboard' }).click();
        await expect(page.getByRole('application', { name: /Virtual Piano Keyboard/i })).toBeHidden();
    });

    test('Can click a piano key to trigger a note', async ({ page }) => {
        const key = page.getByRole('application', { name: /Virtual Piano Keyboard/i }).getByRole('button', { name: /C4/i });
        await key.click();
        await expect(key).toBeVisible();
    });
});
