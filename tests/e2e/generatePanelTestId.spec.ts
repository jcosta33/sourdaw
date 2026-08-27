import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test.describe('Generate panel — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('opening generate panel shows Patterns and AI tabs', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();

        await expect(page.getByRole('button', { name: 'Patterns', exact: true })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: 'AI', exact: true })).toBeVisible({ timeout: 5000 });
    });

    test('Patterns tab is active by default', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();

        const patterns = page.getByRole('button', { name: 'Patterns', exact: true });
        const ai = page.getByRole('button', { name: 'AI', exact: true });

        // Patterns should be secondary (active), AI should be ghost (inactive).
        await expect(patterns).toHaveAttribute('data-variant', 'secondary');
        await expect(ai).toHaveAttribute('data-variant', 'ghost');
    });

    test('switching to AI tab changes active variant', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();

        const ai = page.getByRole('button', { name: 'AI', exact: true });
        await expect(ai).toHaveAttribute('data-variant', 'ghost');

        await ai.click();

        await expect(ai).toHaveAttribute('data-variant', 'secondary');
        await expect(page.getByText('Describe the Music')).toBeVisible();
    });

    test('switching back to Patterns tab restores active state', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();

        const patterns = page.getByRole('button', { name: 'Patterns', exact: true });
        const ai = page.getByRole('button', { name: 'AI', exact: true });

        await ai.click();
        await expect(ai).toHaveAttribute('data-variant', 'secondary');

        await patterns.click();

        await expect(patterns).toHaveAttribute('data-variant', 'secondary');
        await expect(page.getByLabel('Search MIDI patterns')).toBeVisible();
    });

    test('generate panel shows content below tabs', async ({ page }) => {
        await page.getByTestId('toggle-generate').click();

        await expect(page.getByLabel('Search MIDI patterns')).toBeVisible({ timeout: 5000 });
    });
});
