import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Mixer AI Mix Health Analysis button depth. The button is existence-only
// ("AI Mix Health Analysis button is present"). This asserts clicking it opens
// the MixHealthDialog (a real state change: dialog appears where there was none).
test.describe('Mixer AI Mix Health — dialog opens on click', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
        await wait_for_workspace_ready(page);
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        if (!/true/i.test((await dock.getAttribute('aria-pressed')) ?? '')) {
            await dock.click();
        }
        await page.waitForTimeout(500);
    });

    test('clicking AI Mix Health opens the analysis dialog', async ({ page }) => {
        const button = page.getByTestId('mixer-ai-health');
        await expect(button).toBeVisible({ timeout: 10_000 });

        // Before: no Mix Health dialog.
        await expect(page.getByRole('dialog', { name: /Mix Health/i })).toHaveCount(0);

        // Click — opens the dialog.
        await button.click();
        await page.waitForTimeout(500);

        // The dialog appeared — a real state change.
        await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 });
    });
});
