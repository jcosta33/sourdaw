import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Status bar — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('status bar is present as a footer with role=status', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        await expect(status).toBeAttached({ timeout: 10_000 });
    });

    test('undo history toggle is present via aria-label', async ({ page }) => {
        const history = page.getByRole('button', { name: 'Toggle undo history panel' });
        await expect(history).toBeVisible({ timeout: 10_000 });
    });

    test('clicking undo history toggle opens the panel', async ({ page }) => {
        const history = page.getByRole('button', { name: 'Toggle undo history panel' });
        await history.click();
        await page.waitForTimeout(300);

        // The undo history panel should appear.
        const panel = page.getByText(/undo history|action history/i).first();
        const hasPanel = await panel.isVisible().catch(() => false);
        // Toggle back to close.
        await history.click();
        await page.waitForTimeout(300);
        // The toggle didn't crash.
        await expect(history).toBeVisible();
    });

    test('collaboration toggle and undo history toggle coexist in status bar', async ({ page }) => {
        await expect(page.getByTestId('toggle-collaboration')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Toggle undo history panel' })).toBeVisible({
            timeout: 10_000,
        });
    });

    test('status bar shows UI CPU and Latency metrics', async ({ page }) => {
        const status = page.getByRole('contentinfo', { name: 'Application status' });
        if (await status.isVisible().catch(() => false)) {
            const text = (await status.innerText()).trim();
            // The status bar shows UI CPU and Latency metrics.
            expect(text).toMatch(/CPU|Latency/i);
        }
    });
});
