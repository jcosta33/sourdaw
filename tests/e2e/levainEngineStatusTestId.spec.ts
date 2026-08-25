import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openLevain(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Levain/ }).click();
    await expect(page.getByRole('button', { name: 'Close Levain' })).toBeVisible({
        timeout: 30_000,
    });
}

test.describe('Levain engine status', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openLevain(page);
    });

    test('the status LED reaches Engine ready and shows Ready', async ({ page }) => {
        const led = page.getByRole('status', { name: 'Engine ready' });
        await expect(led).toBeVisible({ timeout: 30_000 });
        await expect(led).toHaveText('Ready');
    });
});
