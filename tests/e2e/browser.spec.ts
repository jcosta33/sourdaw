import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Browser Panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can open and interact with the browser panel', async ({ page }) => {
        // By default, the browser panel might be closed or open, but let's ensure we can toggle it
        const toggleButton = page.getByRole('button', { name: /Toggle browser/i });
        await expect(toggleButton).toBeVisible();

        // The browser panel
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
        
        // If it's not visible, click the toggle to open it
        if (!(await browserPanel.isVisible())) {
            await toggleButton.click();
            await expect(browserPanel).toBeVisible();
        }

        // Test the Search input
        const searchInput = browserPanel.getByRole('searchbox', { name: /Search browser/i });
        await expect(searchInput).toBeVisible();
        
        // Fill out a search query
        await searchInput.fill('Synth');
        await expect(searchInput).toHaveValue('Synth');

        // Test closing the browser panel
        const closeButton = browserPanel.getByRole('button', { name: /Close browser/i });
        await expect(closeButton).toBeVisible();
        await closeButton.click();
        
        await expect(browserPanel).not.toBeVisible();
    });
});
