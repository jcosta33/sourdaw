import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');
    // Basic smoke test to ensure the dev server started and rendered the app shell
    await expect(page).toHaveTitle(/Sourdaw/i);
});
