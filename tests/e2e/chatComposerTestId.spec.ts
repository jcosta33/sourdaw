import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openChatPanel(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
    await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('log', { name: 'Chat conversation' })).toBeVisible();
}

test.describe('Chat composer', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openChatPanel(page);
    });

    test('opens disabled while local AI is unavailable and closes on toggle', async ({ page }) => {
        const input = page.getByRole('textbox', { name: 'Chat message input', exact: true });
        await expect(input).toBeVisible();
        await expect(input).toBeDisabled();
        await expect(page.getByText('Local AI Not Available', { exact: true })).toBeVisible();

        const toggle = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(input).toHaveCount(0);
        await expect(page.getByRole('log', { name: 'Chat conversation' })).toHaveCount(0);
    });
});
