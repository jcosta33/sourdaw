import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

// Toaster kit selection: the kit picker buttons only showed the active kit via
// a CSS class, so the selection state was not DOM-observable and the buttons
// shared no accessible name. They now carry aria-pressed + aria-label, so this
// spec asserts the real state change: selecting a different kit flips the
// active button's aria-pressed.
test.describe('Toaster kit selection — switching kits flips aria-pressed', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('selecting a kit marks it aria-pressed true', async ({ page }) => {
        // The kit picker is a list of "Load kit <name>" buttons. Selecting one
        // marks it active (aria-pressed true) — the kit-load state change.
        const kitButtons = page.getByRole('button', { name: /^Load kit /i });
        await expect(kitButtons.first()).toBeVisible({ timeout: 10_000 });
        const count = await kitButtons.count();
        expect(count).toBeGreaterThanOrEqual(2);

        // Pick the second kit button and capture its name.
        const second = kitButtons.nth(1);
        const secondName = (await second.getAttribute('aria-label')) ?? '';
        expect(secondName).toBeTruthy();

        await second.click();
        await page.waitForTimeout(400);

        // The selected kit is now the active one — aria-pressed flipped to true.
        await expect(page.getByRole('button', { name: secondName })).toHaveAttribute('aria-pressed', 'true');
    });
});
