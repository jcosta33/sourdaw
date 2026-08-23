import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPreferencesAi(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(dialog.getByText('AI execution backend')).toBeVisible();
}

test.describe('Preferences — AI execution backend', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('browser with no admitted local model exposes only the automatic backend', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        await openPreferencesAi(page);

        const backend = dialog.getByRole('combobox', { name: 'AI execution backend' });
        const options = backend.locator('option');
        await expect(options).toHaveCount(1);
        await expect(backend).toHaveValue('auto');
        await expect(options).toHaveText(['Automatic']);
        await expect(
            dialog.getByText(
                'No local language model is admitted in this release. Hosted providers remain desktop-only.'
            )
        ).toBeVisible();
    });
});
