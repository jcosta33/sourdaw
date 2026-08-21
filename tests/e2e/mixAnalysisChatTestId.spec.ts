import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function openCommand(page: Page, name: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill(name);
    await page.getByRole('option', { name }).click();
}

test.describe('Mix analysis and chat', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
    });

    test('Analyze Mix opens the Mix Analysis panel with a refresh control', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Refresh mix analysis' })).toHaveCount(0);

        await openCommand(page, 'Analyze Mix');

        await expect(page.getByText('Mix Analysis', { exact: true })).toBeVisible();
        const refresh = page.getByRole('button', { name: 'Refresh mix analysis' });
        await expect(refresh).toBeVisible();
        await expect(refresh).toHaveAttribute('aria-label', 'Refresh mix analysis');

        await page.getByRole('button', { name: 'Close mix analysis' }).click();
        await expect(refresh).toHaveCount(0);
    });

    test('chat opens an empty conversation log with polite live region', async ({ page }) => {
        const toggle = page.getByRole('button', { name: 'Toggle AI chat panel' });
        const log = page.getByRole('log', { name: 'Chat conversation' });

        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(log).toHaveCount(0);
        await expect(page.getByText('The kitchen is quiet', { exact: true })).toHaveCount(0);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(log).toBeVisible();
        await expect(log).toHaveAttribute('aria-live', 'polite');
        await expect(page.getByText('The kitchen is quiet', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Confirm pending actions' })).toHaveCount(0);

        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-pressed', 'true');
        await expect(log).toHaveCount(0);
    });

    test('Analysis dock tab shows the spectrum analyzer', async ({ page }) => {
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        await expect(dock).not.toHaveAttribute('aria-pressed', 'true');

        await dock.click();
        await expect(dock).toHaveAttribute('aria-pressed', 'true');

        const tab = page
            .getByRole('tablist', { name: 'Bottom dock' })
            .getByRole('tab', { name: 'Analysis', exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText('Spectrum Analyzer', { exact: true })).toBeVisible();
    });

    test('Analysis dock and chat can be open together', async ({ page }) => {
        const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
        const chat = page.getByRole('button', { name: 'Toggle AI chat panel' });

        await dock.click();
        await page
            .getByRole('tablist', { name: 'Bottom dock' })
            .getByRole('tab', { name: 'Analysis', exact: true })
            .click();
        await chat.click();

        await expect(dock).toHaveAttribute('aria-pressed', 'true');
        await expect(chat).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Spectrum Analyzer', { exact: true })).toBeVisible();
        await expect(page.getByText('The kitchen is quiet', { exact: true })).toBeVisible();
    });
});
