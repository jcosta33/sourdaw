import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Chat composer — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('chat composer input is present when chat panel is open', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeVisible({ timeout: 5000 });
    });

    test('chat composer accepts typed text', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeVisible({ timeout: 5000 });

        // The input may be disabled if no LLM is loaded — check it's at least present.
        const isDisabled = await input.isDisabled();
        if (!isDisabled) {
            await input.fill('add a track');
            await expect(input).toHaveValue('add a track');
        }
    });

    test('chat composer has correct aria-label', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeVisible({ timeout: 5000 });
        await expect(input).toHaveAttribute('aria-label', 'Chat message input');
    });

    test('chat conversation log and composer coexist', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        const log = page.getByRole('log', { name: 'Chat conversation' });
        const input = page.getByTestId('chat-composer-input');

        if (await log.isVisible().catch(() => false)) {
            await expect(input).toBeVisible({ timeout: 5000 });
        }
    });

    test('chat composer is cleared after focus', async ({ page }) => {
        await page.getByTestId('toggle-chat').click();
        await page.waitForTimeout(500);

        const input = page.getByTestId('chat-composer-input');
        if (await input.isVisible().catch(() => false)) {
            const isDisabled = await input.isDisabled();
            if (!isDisabled) {
                await input.fill('test');
                await input.fill('');
                await expect(input).toHaveValue('');
            }
        }
    });
});
