import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openSetlistTab(page: Page): Promise<void> {
    const dock = page.getByTestId('toggle-bottom-dock');
    const isOpen = await dock.getAttribute('aria-pressed');
    if (isOpen === 'false') {
        await dock.click();
        await page.waitForTimeout(500);
    }

    const setlistTab = page.locator('#bottom-dock-tab-setlist');
    if (await setlistTab.isVisible().catch(() => false)) {
        await setlistTab.click();
        await page.waitForTimeout(500);
    }
}

// A single click must add exactly one item — previous attempts at double-add
// flows were flaky, so every test here works from a strict 0 → 1 transition.
async function addOneItem(page: Page): Promise<void> {
    const add = page.getByTestId('setlist-add-item');
    await expect(add).toBeVisible();
    await add.click();

    const list = page.getByRole('list', { name: 'Setlist items' });
    await expect(list).toBeVisible();
}

test.describe('Setlist per-item controls — AS toggle and Remove', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openSetlistTab(page);
    });

    test('removing the only item restores the empty state', async ({ page }) => {
        await addOneItem(page);

        const list = page.getByRole('list', { name: 'Setlist items' });
        const items = list.getByRole('listitem');
        await expect(items).toHaveCount(1);

        // The single item is named "Song 1" (addSetlistItem uses
        // `Song ${items.length + 1}`), so the Remove control is labeled
        // "Remove Song 1" — scope to the row to prove the label binds to the
        // item, not just to any Remove button in the panel.
        const row = items.filter({ hasText: 'Song 1' });
        await expect(row).toHaveCount(1);

        // The remove/move cluster is opacity-0 until the row is hovered
        // (group-hover). Hovering the row first satisfies the gate the same
        // way a user would; opacity alone does not block Playwright, but the
        // hover keeps the click on the visible affordance.
        await row.hover();

        const remove = row.getByRole('button', { name: 'Remove Song 1' });
        await expect(remove).toBeVisible();
        await remove.click();

        // With the last item gone the list unmounts and the DawEmptyState
        // ("No setlist items") takes its place.
        await expect(list).toBeHidden();
        await expect(page.getByText('No setlist items')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add first item' })).toBeVisible();
    });

    test('AS auto-stop toggle flips aria-pressed and its label', async ({ page }) => {
        await addOneItem(page);

        const items = page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem');
        await expect(items).toHaveCount(1);

        // The AS toggle sits outside the hover-gated cluster, so it is always
        // reachable. Its accessible name and aria-pressed mirror item.autoStop,
        // which addSetlistItem defaults to true — start the flip from "on".
        const toggle = page.getByRole('button', { name: /AS: Auto-stop/i });
        await expect(toggle).toHaveAccessibleName('AS: Auto-stop on');
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');

        await toggle.click();

        await expect(toggle).toHaveAccessibleName('AS: Auto-stop off');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // Round-trip back to on so both edges of the flip are covered.
        await toggle.click();

        await expect(toggle).toHaveAccessibleName('AS: Auto-stop on');
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
});
