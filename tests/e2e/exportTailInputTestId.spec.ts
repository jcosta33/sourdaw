import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const isMac = process.platform === 'darwin';

// Export dialog tail-seconds input depth. Existing spec asserts the input IS
// PRESENT — existence only. This asserts typing a new value commits it.
test.describe('Export tail-seconds input — value commit', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
        await page.keyboard.press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
        const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
        await expect(dialog).toBeVisible({ timeout: 5000 });
    });

    test('typing a new tail value commits to the input', async ({ page }) => {
        const tail = page.getByLabel('Tail seconds');
        await expect(tail).toBeVisible({ timeout: 5000 });
        await expect(tail).toBeDisabled(); // autoTail is on by default

        // Disable auto-detect to enable the manual input.
        await page.getByLabel('Auto-detect').uncheck();
        await expect(tail).toBeEnabled();
        await expect(tail).toHaveValue('2');

        // Type a new value.
        await tail.fill('5');
        await expect(tail).toHaveValue('5');
    });
});
