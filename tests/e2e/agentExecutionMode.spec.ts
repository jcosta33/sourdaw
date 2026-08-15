import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openChatPanel(page: Page): Promise<void> {
    await page.getByTestId('toggle-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
}

// The execution-mode select governs whether the agent explains, plans,
// previews, applies, or macros — the highest-leverage AI control on the
// composer, introduced with the governed-execution cluster and previously
// covered only by the composer's input-presence assertions.
test.describe('Chat composer — agent execution mode select', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openChatPanel(page);
    });

    test('switching modes updates the select and the composer contract', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        const mode = page.getByRole('combobox', { name: 'Agent execution mode' });
        await expect(mode).toBeVisible({ timeout: 10_000 });

        // Default is Explain: conversational placeholder, chat mode.
        await expect(mode).toHaveValue('explain');
        await expect(input).toHaveAttribute(
            'placeholder',
            'Send a message... (Shift+Enter for newline)'
        );
        // The labels stay capitalized — the value is what flows to the send
        // path, the label is what the user reads.
        await expect(mode.locator('option')).toHaveText([
            'Explain',
            'Plan',
            'Preview',
            'Apply',
            'Macro',
        ]);

        // Any non-explain mode flips the composer to its command contract:
        // the placeholder names execution, the value follows the selection.
        for (const option of ['plan', 'preview', 'apply', 'macro']) {
            await mode.selectOption(option);
            await expect(mode).toHaveValue(option);
            await expect(input).toHaveAttribute(
                'placeholder',
                'Type a command to execute or generate...'
            );
        }

        // Back to Explain: the conversational placeholder returns.
        await mode.selectOption('explain');
        await expect(mode).toHaveValue('explain');
        await expect(input).toHaveAttribute(
            'placeholder',
            'Send a message... (Shift+Enter for newline)'
        );
    });
});
