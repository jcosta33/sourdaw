import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Collaboration panel — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('collaboration toggle is visible via test ID', async ({ page }) => {
        const collab = page.getByTestId('toggle-collaboration');
        await expect(collab).toBeVisible({ timeout: 10_000 });
    });

    test('clicking collaboration toggle opens the panel dialog', async ({ page }) => {
        const collab = page.getByTestId('toggle-collaboration');
        await collab.click();
        await page.waitForTimeout(500);

        const panel = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(panel).toBeVisible({ timeout: 5000 });
    });

    test('collaboration panel shows status text', async ({ page }) => {
        await page.getByTestId('toggle-collaboration').click();
        await page.waitForTimeout(500);

        const panel = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(panel).toBeVisible();

        // The panel should show some status text (e.g. "Not connected").
        const text = (await panel.innerText()).trim();
        expect(text.length).toBeGreaterThan(0);
    });

    test('collaboration panel can be closed by toggling again', async ({ page }) => {
        const collab = page.getByTestId('toggle-collaboration');
        await collab.click();
        await page.waitForTimeout(500);

        const panel = page.getByRole('dialog', { name: 'Collaborate' });
        await expect(panel).toBeVisible();

        // Toggle again to close.
        await collab.click();
        await page.waitForTimeout(500);

        await expect(panel).not.toBeVisible();
    });

    test('collaboration toggle shows peer count (0 when not connected)', async ({ page }) => {
        const collab = page.getByTestId('toggle-collaboration');
        const text = (await collab.innerText()).trim();
        // When no session is active, it shows 0.
        expect(text).toContain('0');
    });
});
