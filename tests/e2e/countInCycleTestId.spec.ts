import { test, expect } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Count-in enable/disable — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('count-in toggle enables and shows bars pill', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await expect(countIn).toBeVisible({ timeout: 10_000 });
        await countIn.click();
        await expect(countIn).toHaveAttribute('aria-pressed', 'true');

        const pill = page.locator('[aria-label*="Count-in bars"]').first();
        await expect(pill).toBeVisible({ timeout: 5000 });
    });

    test('count-in bars pill shows 1 by default', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await countIn.click();
        await page.waitForTimeout(300);

        const pill = page.locator('[aria-label*="Count-in bars"]').first();
        const text = (await pill.innerText()).trim();
        expect(text).toContain('1');
    });

    test('count-in pill has correct aria-label with bars count', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await countIn.click();
        await page.waitForTimeout(300);

        const pill = page.locator('[aria-label*="Count-in bars"]').first();
        const label = await pill.getAttribute('aria-label');
        expect(label).toContain('Count-in bars');
        expect(label).toContain('1');
    });

    test('disabling count-in hides the pill', async ({ page }) => {
        const countIn = page.getByTestId('transport-countin');
        await countIn.click();
        await page.waitForTimeout(300);
        const pill = page.locator('[aria-label*="Count-in bars"]').first();
        await expect(pill).toBeVisible();

        await countIn.click();
        await page.waitForTimeout(300);
        await expect(pill).not.toBeVisible();
    });

    test('punch and count-in can be enabled simultaneously', async ({ page }) => {
        const punch = page.getByTestId('transport-punch');
        const countIn = page.getByTestId('transport-countin');

        await punch.click();
        await expect(punch).toHaveAttribute('aria-pressed', 'true');

        await countIn.click();
        await expect(countIn).toHaveAttribute('aria-pressed', 'true');

        // Both enabled.
        await expect(punch).toHaveAttribute('aria-pressed', 'true');
        await expect(countIn).toHaveAttribute('aria-pressed', 'true');
    });
});
