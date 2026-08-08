import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Punch recording & count-in — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('punch in/out toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const punch = page.getByTestId('transport-punch');
        await expect(punch).toBeVisible({ timeout: 10_000 });
        await expect(punch).toHaveAttribute('aria-pressed', 'false');

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'true');

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'false');
    });

    test('count-in toggle enables and shows bars pill via test ID', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await expect(countIn).toBeVisible({ timeout: 10_000 });
        await expect(countIn).toHaveAttribute('aria-pressed', 'false');

        // Enable count-in — the bars pill should appear.
        await countIn.click();
        await expect(countIn).toHaveAttribute('aria-pressed', 'true');

        // The count-in bars pill should be visible.
        const barsPill = page.locator('[aria-label*="Count-in bars"]').first();
        await expect(barsPill).toBeVisible({ timeout: 5000 });

        // Default is 1 bar.
        const text = (await barsPill.innerText()).trim();
        expect(text).toContain('1');
    });

    test('disabling count-in hides the bars pill', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await countIn.click();
        await page.waitForTimeout(300);

        const barsPill = page.locator('[aria-label*="Count-in bars"]').first();
        await expect(barsPill).toBeVisible({ timeout: 5000 });

        // Disable count-in.
        await countIn.click();
        await page.waitForTimeout(300);

        await expect(barsPill).not.toBeVisible();
    });
});
