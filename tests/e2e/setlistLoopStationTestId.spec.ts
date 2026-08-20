import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test.describe('Setlist & loop station — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('clicking add creates a setlist item', async ({ page }) => {
        await openBottomTab(page, 'Setlist');
        const add = page.getByTestId('setlist-add-item');
        await expect(add).toBeVisible();
        await add.click();

        const items = page.getByRole('list', { name: 'Setlist items' }).getByRole('listitem');
        await expect(items).toHaveCount(1);
        await expect(items.first()).toContainText('Song 1');
    });

    test('loop station region is present', async ({ page }) => {
        await openBottomTab(page, 'Loop Station');
        const station = page.getByRole('region', { name: 'Loop station' });
        await expect(station).toBeVisible();
        await expect(station.getByRole('button', { name: 'Arm loop station' })).toBeVisible();
    });

    test('loop station arm button is present when tab is active', async ({ page }) => {
        await openBottomTab(page, 'Loop Station');
        const arm = page.getByRole('button', { name: 'Arm loop station' });
        await expect(arm).toBeVisible();
        await arm.click();
        await expect(page.getByRole('button', { name: 'Disarm loop station' })).toBeVisible();
    });
});
