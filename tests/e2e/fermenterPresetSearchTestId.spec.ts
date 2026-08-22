import { expect, test } from '@playwright/test';

import { launch_new_project, open_browser_instrument, setupWorkspace } from './e2eUtils';

test.describe('Fermenter preset search', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await open_browser_instrument({ page, instrument: 'Fermenter' });
    });

    test('reese keeps Rye Reese, hides Blank Dough, and clear restores both', async ({ page }) => {
        const panel = page.locator('.fermenter-faceplate');
        const search = panel.getByPlaceholder('Search presets…');
        const ryeReese = panel.getByRole('button', { name: 'Rye Reese', exact: true });
        const blankDough = panel.getByRole('button', { name: 'Blank Dough', exact: true });

        await expect(blankDough).toBeVisible();
        await expect(ryeReese).toBeVisible();

        await search.fill('reese');
        await expect(panel.getByText('1 presets', { exact: true })).toBeVisible();
        await expect(ryeReese).toBeVisible();
        await expect(blankDough).toHaveCount(0);

        await search.fill('');
        await expect(blankDough).toBeVisible();
        await expect(ryeReese).toBeVisible();
    });
});
