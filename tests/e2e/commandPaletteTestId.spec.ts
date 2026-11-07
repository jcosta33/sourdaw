import { test, expect } from './e2eTest';
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
});
