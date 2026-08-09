import { test, expect } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

function trackRow(page: import('@playwright/test').Page, name: RegExp | string) {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .filter({ hasText: name })
        .first();
}

test.describe('Inline track rename', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('double-click the name, type a new one, Enter commits', async ({ page }) => {
        const row = trackRow(page, /Kick/i);
        await row.waitFor({ state: 'attached' });

        // Original name is present.
        await expect(row).toContainText('Kick');

        // Double-click the name span to enter edit mode.
        const nameSpan = row.locator('span', { hasText: 'Kick' }).first();
        await nameSpan.dblclick();

        // Edit input appears with an aria-label seeded from the original name.
        const editInput = page.getByLabel('Rename track Kick');
        await expect(editInput).toBeVisible();

        // Replace the value and commit with Enter.
        await editInput.fill('Kick Drum');
        await editInput.press('Enter');

        // The committed name now renders; the old one is gone.
        await expect(row).toContainText('Kick Drum');
        await expect(page.getByLabel('Rename track Kick')).toHaveCount(0);
    });

    test('Escape cancels and restores the original name', async ({ page }) => {
        const row = trackRow(page, /Kick/i);
        const nameSpan = row.locator('span', { hasText: 'Kick' }).first();
        await nameSpan.dblclick();

        const editInput = page.getByLabel('Rename track Kick');
        await editInput.fill('Should Not Persist');
        await editInput.press('Escape');

        // Edit input closes.
        await expect(editInput).toHaveCount(0);
        // Original name is untouched.
        await expect(row).toContainText('Kick');
        await expect(row).not.toContainText('Should Not Persist');
    });

    test('rename via context menu Rename item commits on Enter', async ({ page }) => {
        const row = trackRow(page, /Kick/i);
        await row.click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });

        await page.getByRole('menuitem', { name: /^Rename$/ }).click();

        // The menu swaps to an inline editor whose input lives inside the menu.
        const menu = page.getByRole('menu');
        const editInput = menu.getByRole('textbox');
        await expect(editInput).toBeVisible();
        await editInput.fill('Bottom End');
        await editInput.press('Enter');

        // New name committed — rows holding "Bottom End" now exist (the old
        // Kick row is gone). Use a count so multiple matching rows don't trip
        // strict-mode.
        const bottomEndRows = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: /Bottom End/i });
        await expect(bottomEndRows).toHaveCount(2);
    });
});
