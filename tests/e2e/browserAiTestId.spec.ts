import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Browser & AI panels — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('browser search input is present and accepts typed text', async ({ page }) => {
        // The browser panel may already be open — look for the search input.
        const search = page.getByTestId('browser-search');
        // If the browser is closed, open it.
        if (!(await search.isVisible().catch(() => false))) {
            await page.getByRole('button', { name: 'Toggle browser' }).click();
            await page.waitForTimeout(300);
        }
        await expect(search).toBeVisible({ timeout: 5000 });

        await search.fill('fermenter');
        await expect(search).toHaveValue('fermenter');

        await search.fill('');
        await expect(search).toHaveValue('');
    });

    test('generate panel toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const generate = page.getByTestId('toggle-generate');
        await expect(generate).toBeVisible();
        await expect(generate).toHaveAttribute('aria-pressed', 'false');

        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'true');

        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'false');
    });

    test('chat panel toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const chat = page.getByTestId('toggle-chat');
        await expect(chat).toBeVisible();
        await expect(chat).toHaveAttribute('aria-pressed', 'false');

        await chat.click();
        await expect(chat).toHaveAttribute('aria-pressed', 'true');

        await chat.click();
        await expect(chat).toHaveAttribute('aria-pressed', 'false');
    });

    test('opening generate panel then closing returns to false', async ({ page }) => {
        const generate = page.getByTestId('toggle-generate');

        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'true');

        // Close it.
        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'false');
    });

    test('chat and generate can both be open simultaneously', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(200);
        await page.getByTestId('toggle-generate').click();
        await page.waitForTimeout(200);

        await expect(page.getByTestId('toggle-chat')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('toggle-generate')).toHaveAttribute('aria-pressed', 'true');
    });
});
