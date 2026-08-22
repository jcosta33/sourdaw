import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Generate and chat panels', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Generate and chat can stay open together; closing Generate leaves chat', async ({ page }) => {
        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        const chat = page.getByRole('button', { name: 'Toggle AI chat panel', exact: true });
        const patternsSearch = page.getByRole('textbox', { name: 'Search MIDI patterns' });
        const chatLog = page.getByRole('log', { name: 'Chat conversation' });

        await expect(generate).not.toHaveAttribute('aria-pressed', 'true');
        await expect(patternsSearch).toHaveCount(0);

        await generate.click();
        await expect(generate).toHaveAttribute('aria-pressed', 'true');
        await expect(patternsSearch).toBeVisible();

        await chat.click();
        await expect(chat).toHaveAttribute('aria-pressed', 'true');
        await expect(chatLog).toBeVisible();
        await expect(patternsSearch).toBeVisible();

        await generate.click();
        await expect(generate).not.toHaveAttribute('aria-pressed', 'true');
        await expect(patternsSearch).toHaveCount(0);
        await expect(chatLog).toBeVisible();
    });
});
