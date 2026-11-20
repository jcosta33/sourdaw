import { test, expect } from './e2eTest';
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

    test('keeps the project name editor open when Enter confirms IME composition', async ({ page }) => {
        await page.getByTestId('project-name').click();
        const editor = page.getByRole('textbox', { name: 'Project name' });
        await editor.fill('新しい曲');
        await editor.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
        await expect(editor).toBeVisible();
        await expect(editor).toHaveValue('新しい曲');
        await editor.press('Enter');
        await expect(editor).toHaveCount(0);
        await expect(page.getByTestId('project-name')).toHaveText('新しい曲');
    });

    test('preferences toggle is visible via test ID', async ({ page }) => {
        const prefs = page.getByTestId('toggle-preferences');
        await expect(prefs).toBeVisible({ timeout: 10_000 });
    });

    // preferencesDialogDeepTestId owns unconditional dialog opening and navigation.

    test('project name and preferences are in the transport bar simultaneously', async ({ page }) => {
        await expect(page.getByTestId('project-name')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('toggle-preferences')).toBeVisible({ timeout: 10_000 });
    });
});
