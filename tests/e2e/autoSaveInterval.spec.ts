import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openPreferencesGeneral(page: Page): Promise<void> {
    await page.getByTestId('toggle-preferences').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'General', exact: true }).click();
    await expect(dialog.getByText('Track Height')).toBeVisible();
}

// The Auto Save toggle itself is covered (preferencesDialogDeepTestId); the
// interval select beside it (added with the auto-save snapshot work) is not.
test.describe('Preferences — auto-save interval', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPreferencesGeneral(page);
    });

    test('the interval select changes and persists across dialog reopen', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        const interval = dialog.getByRole('combobox', { name: 'Auto-save interval' });
        // Default is the first option: 30 seconds.
        await expect(interval).toHaveValue('30000');

        await interval.selectOption({ label: '5 minutes' });
        await expect(interval).toHaveValue('300000');

        // Preferences are durable state, not dialog-local: closing and
        // reopening the dialog must show the committed value.
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await openPreferencesGeneral(page);
        await expect(dialog.getByRole('combobox', { name: 'Auto-save interval' })).toHaveValue('300000');
    });

    test('Reset Defaults restores the 30-second interval', async ({ page }) => {
        const dialog = page.getByRole('dialog');
        const interval = dialog.getByRole('combobox', { name: 'Auto-save interval' });
        await interval.selectOption({ label: '2 minutes' });
        await expect(interval).toHaveValue('120000');

        await dialog.getByRole('button', { name: /Reset Defaults/i }).click();
        await expect(interval).toHaveValue('30000');
    });
});
