import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The Branch Manager dialog is mounted in AppShell but gated on the workspace
 * `branchManagerOpen` flag, and until the `open-branch-manager` command was
 * added nothing in the UI ever flipped that flag — so the dialog was
 * unreachable. This proves the wiring end to end: run the new command-palette
 * entry and assert the dialog actually renders its branch-management content
 * (the seeded "Main" branch row and the fork input), not just a wrapper.
 */
test.describe('Branch Manager (command-palette entry)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Running "Open Branch Manager" from the command palette opens the branch dialog', async ({ page }) => {
        const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
        await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

        const palette = page.getByRole('dialog', { name: /Command Palette/i });
        await expect(palette).toBeVisible();

        const input = palette.getByPlaceholder(/Type a command/i);
        await expect(input).toBeFocused();
        await input.fill('Open Branch Manager');

        const option = palette.getByRole('option', { name: /Open Branch Manager/i });
        await expect(option).toBeVisible();
        await expect(option).toHaveAttribute('aria-selected', 'true');

        await page.keyboard.press('Enter');

        // The palette closes and the branch manager takes over.
        await expect(palette).not.toBeVisible();

        const branchDialog = page.getByRole('dialog', { name: /Branches/i });
        await expect(branchDialog).toBeVisible();

        // Real branch-list content: the default project seeds a "Main" branch,
        // rendered as its switch control and flagged as the current branch.
        const mainBranch = branchDialog.getByRole('button', { name: /Switch to branch Main/i });
        await expect(mainBranch).toBeVisible();
        await expect(mainBranch).toHaveAttribute('aria-current', 'true');

        // The fork affordance is part of the dialog body, not a bare wrapper.
        await expect(branchDialog.getByPlaceholder(/New branch name/i)).toBeVisible();
        await expect(branchDialog.getByRole('button', { name: /Fork/i })).toBeVisible();

        // Closing the dialog dismisses it, confirming the toggle round-trips.
        await branchDialog.getByRole('button', { name: /Close branch manager/i }).click();
        await expect(branchDialog).not.toBeVisible();
    });
});
