import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Prompt bar and AI action history', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('AI action history opens empty and the toggle dismisses it', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle AI action history', exact: true });
        const close = page.getByRole('button', { name: 'Close action history', exact: true });

        await expect(close).toHaveCount(0);
        await toggle.click();
        await expect(close).toBeVisible();
        await expect(page.getByText('No actions yet', { exact: true })).toBeVisible();

        await toggle.click();
        await expect(close).toHaveCount(0);
        await expect(page.getByText('No actions yet', { exact: true })).toHaveCount(0);
    });

    test('choosing Add MIDI Track from prompt suggestions creates a track and lists it in action history', async ({
        page,
    }) => {
        const input = page.getByRole('textbox', { name: 'Prompt command input', exact: true });
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        const close = page.getByRole('button', { name: 'Close action history', exact: true });

        await input.click();
        await input.fill('Add MIDI Track');
        await expect(input).toHaveAttribute('aria-expanded', 'true');

        const suggestions = page.getByRole('listbox', { name: 'Command suggestions', exact: true });
        await expect(suggestions).toBeVisible();
        await suggestions.getByRole('option', { name: 'Add MIDI Track Track', exact: true }).click();

        await expect(page.getByRole('status').filter({ hasText: 'Executed: Add MIDI Track' })).toBeVisible();
        const last = status.getByText(/^Last: Add midi track /);
        await expect(last).toBeVisible();
        const lastAction = (await last.innerText()).replace(/^Last:\s*/, '');

        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await expect(trackList).toBeVisible();
        await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
        await expect(input).toHaveValue('');

        await expect(close).toBeVisible();
        await expect(page.getByText('No actions yet', { exact: true })).toHaveCount(0);
        await expect(page.getByText(lastAction, { exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'Toggle AI action history', exact: true }).click();
        await expect(close).toHaveCount(0);
    });
});
