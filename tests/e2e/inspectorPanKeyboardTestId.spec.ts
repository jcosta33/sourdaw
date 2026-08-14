import { expect, test } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// Inspector pan keyboard response. The existing pan coverage in
// inspectorDeepTestId.spec.ts is existence-only ("inspector pan control is
// present via test ID"), and the keyboard test at line 46 wraps its assertion
// in a skip-guard (`if (await slider.isVisible().catch(() => false))`) that
// silently passes when the slider is not visible. This spec selects the first
// track, asserts the pan slider is genuinely visible, and verifies ArrowRight
// raises aria-valuenow — with no skip-guard.
test.describe('Inspector track pan — keyboard response', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('track pan slider responds to ArrowRight', async ({ page }) => {
        // Selecting the first track mounts its inspector pan control.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click();

        const pan = page.getByTestId('inspector-track-pan').getByRole('slider');
        await expect(pan).toBeVisible({ timeout: 10_000 });
        await pan.focus();
        const before = Number(await pan.getAttribute('aria-valuenow'));
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(200);
        const after = Number(await pan.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(before);
    });
});
