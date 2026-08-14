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

// Each click adds exactly one item ("Song <n+1>"); assert the count after
// every click so a double-add cannot silently shift later indices.
async function addItems(page: Page, count: number): Promise<void> {
    const add = page.getByTestId('setlist-add-item');
    await expect(add).toBeVisible();
    for (let i = 1; i <= count; i += 1) {
        await add.click();
        await expect(
            page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem'),
        ).toHaveCount(i);
    }
}

test.describe('Setlist per-item controls — Move up / Move down reorder', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await openSetlistTab(page);
    });

    test('Move down swaps the first two items and Move up swaps them back', async ({ page }) => {
        await addItems(page, 3);
        const items = page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem');

        // The move cluster is opacity-0 until the row is hovered
        // (group-hover); hovering the row first keeps the click on the
        // visible affordance, same as the Remove control.
        const song1 = items.filter({ hasText: 'Song 1' });
        await song1.hover();
        await song1.getByRole('button', { name: 'Move down' }).click();

        await expect(items.nth(0)).toContainText('Song 2');
        await expect(items.nth(1)).toContainText('Song 1');
        await expect(items.nth(2)).toContainText('Song 3');

        const movedSong1 = items.filter({ hasText: 'Song 1' });
        await movedSong1.hover();
        await movedSong1.getByRole('button', { name: 'Move up' }).click();

        await expect(items.nth(0)).toContainText('Song 1');
        await expect(items.nth(1)).toContainText('Song 2');
        await expect(items.nth(2)).toContainText('Song 3');
    });

    test('boundary buttons are disabled and follow the item, not the position', async ({ page }) => {
        await addItems(page, 2);
        const items = page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem');

        const song1 = items.filter({ hasText: 'Song 1' });
        await song1.hover();
        await expect(song1.getByRole('button', { name: 'Move up' })).toBeDisabled();
        await song1.getByRole('button', { name: 'Move down' }).click();

        // After the swap, Song 1 sits last: its Move up is enabled now and
        // its Move down took over the disabled boundary state.
        const movedSong1 = items.filter({ hasText: 'Song 1' });
        await movedSong1.hover();
        await expect(movedSong1.getByRole('button', { name: 'Move up' })).toBeEnabled();
        await expect(movedSong1.getByRole('button', { name: 'Move down' })).toBeDisabled();

        // Song 2 took over the first position, so the boundary states swapped
        // with it: its Move up is now the disabled one.
        const song2 = items.filter({ hasText: 'Song 2' });
        await song2.hover();
        await expect(song2.getByRole('button', { name: 'Move up' })).toBeDisabled();
        await expect(song2.getByRole('button', { name: 'Move down' })).toBeEnabled();
    });
});
