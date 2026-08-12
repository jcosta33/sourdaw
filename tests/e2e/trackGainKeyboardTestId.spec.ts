import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

// Track gain keyboard response. Existing specs assert the gain slider EXISTS
// (has a numeric aria-valuenow) but never test that keyboard changes the value.
// The pan keyboard test exists (inspectorDeepTestId:46) but uses ArrowRight
// behind a skip-guard. This asserts gain responds to ArrowUp.
test.describe('Inspector track gain — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('track gain slider responds to ArrowUp', async ({ page }) => {
        const gain = page.getByTestId('inspector-track-gain').getByRole('slider');
        await expect(gain).toBeVisible({ timeout: 10_000 });
        await gain.focus();
        const before = Number(await gain.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await gain.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
