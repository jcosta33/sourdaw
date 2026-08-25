import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openBottomDock(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle bottom dock', exact: true });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
        await toggle.click();
    }
    await expect(page.getByRole('tablist', { name: 'Bottom dock' })).toBeVisible();
}

test.describe('Bottom dock routing', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openBottomDock(page);
    });

    test('Routing tab replaces the mixer with the routing matrix', async ({ page }) => {
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toBeVisible();

        await page.getByRole('tab', { name: 'Routing', exact: true }).click();
        await expect(page.getByRole('tab', { name: 'Routing', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('region', { name: 'Mixer panel' })).toHaveCount(0);
        const routing = page.getByRole('tabpanel', { name: 'Routing' });
        await expect(routing.getByText('Routing matrix', { exact: true })).toBeVisible();
        await expect(routing.getByRole('columnheader', { name: 'Master', exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'Close bottom dock' }).click();
        await expect(routing).toHaveCount(0);
    });
});
