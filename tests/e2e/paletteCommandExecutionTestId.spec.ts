import { test, expect } from '@playwright/test';

import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

async function openPalette(page: import('@playwright/test').Page): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    await page.getByTestId('command-palette-input').waitFor({ state: 'visible' });
}

async function runPaletteCommand(page: import('@playwright/test').Page, query: string): Promise<void> {
    await openPalette(page);
    const input = page.getByTestId('command-palette-input');
    await input.fill(query);
    await page.waitForTimeout(300);
    // Execute the top match with Enter.
    await input.press('Enter');
    await page.waitForTimeout(400);
}

test.describe('Command palette — command execution (new project)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Export Audio command opens the export dialog', async ({ page }) => {
        await runPaletteCommand(page, 'Export Audio');
        // The command wired through to its action: the export dialog mounts.
        await expect(page.getByTestId('export-mode-mixdown')).toBeVisible({ timeout: 10_000 });
    });

    test('palette filters to a single category query', async ({ page }) => {
        await openPalette(page);
        const input = page.getByTestId('command-palette-input');
        await input.fill('save project');
        await page.waitForTimeout(300);

        const options = page.getByRole('option');
        // The Save Project match must be present and selected.
        await expect(options.filter({ hasText: /Save Project/i })).toBeVisible();
        await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    });
});

test.describe('Command palette — New Project from a loaded template', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: 'Pop Song' });
    });

    test('New Project command clears the template tracks', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const rowsBefore = await trackList.getByRole('row').count();
        expect(rowsBefore).toBeGreaterThan(1);

        await runPaletteCommand(page, 'New Project');

        // A fresh project has no tracks — the empty state returns.
        const emptyState = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await expect(emptyState).toBeVisible({ timeout: 10_000 });
        // And the track list no longer holds the template's rows.
        expect(await trackList.getByRole('row').count()).toBeLessThan(rowsBefore);
    });
});
