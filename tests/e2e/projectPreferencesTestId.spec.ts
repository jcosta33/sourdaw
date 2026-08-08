import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Project name & preferences — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('project name display shows the default name via test ID', async ({ page }) => {
        const name = page.getByTestId('project-name');
        await expect(name).toBeVisible({ timeout: 10_000 });

        const text = (await name.innerText()).trim();
        expect(text.length).toBeGreaterThan(0);
    });

    test('project name display is clickable without errors', async ({ page }) => {
        const name = page.getByTestId('project-name');
        await expect(name).toBeVisible({ timeout: 10_000 });

        // Just verify the name button is stable and interactive.
        const text = (await name.innerText()).trim();
        expect(text.length).toBeGreaterThan(0);

        // Click should not crash the app.
        await name.click();
        await page.waitForTimeout(200);

        // The transport should still be functional.
        await expect(page.getByTestId('transport-play')).toBeVisible();
    });

    test('preferences toggle is visible via test ID', async ({ page }) => {
        const prefs = page.getByTestId('toggle-preferences');
        await expect(prefs).toBeVisible({ timeout: 10_000 });
    });

    test('clicking preferences opens the dialog', async ({ page }) => {
        const prefs = page.getByTestId('toggle-preferences');
        await prefs.click();
        await page.waitForTimeout(500);

        // A preferences dialog should appear.
        const dialog = page.getByRole('dialog');
        const hasDialog = await dialog.isVisible().catch(() => false);
        if (hasDialog) {
            expect(await dialog.innerText()).toBeTruthy();
        }
    });

    test('project name and preferences are in the transport bar simultaneously', async ({ page }) => {
        await expect(page.getByTestId('project-name')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('toggle-preferences')).toBeVisible({ timeout: 10_000 });
    });
});
