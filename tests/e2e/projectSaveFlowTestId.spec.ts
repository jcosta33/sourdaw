import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function runPaletteCommand(page: import('@playwright/test').Page, query: string): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    const input = page.getByTestId('command-palette-input');
    await input.fill(query);
    await page.waitForTimeout(300);
    await input.press('Enter');
}

// The dirty indicator: a status dot carrying title="Unsaved changes", present
// only while the open project has uncommitted edits.
function dirtyDot(page: import('@playwright/test').Page) {
    return page.locator('[title="Unsaved changes"]');
}

test.describe('Project save flow — dirty flag clears', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('making an edit then saving clears the unsaved-changes indicator', async ({ page }) => {
        // A fresh project is clean — no dirty dot.
        await expect(dirtyDot(page)).toHaveCount(0);

        // Adding a track is an edit → dirty.
        await page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' }).click();
        await expect(dirtyDot(page)).toBeVisible({ timeout: 10_000 });

        // Save via the palette's Save Project command.
        await runPaletteCommand(page, 'Save Project');

        // The dirty dot disappears — the save committed and cleared the flag.
        await expect(dirtyDot(page)).toHaveCount(0, { timeout: 15_000 });
    });

    test('a further edit re-asserts dirty after a clean save', async ({ page }) => {
        // Edit + save → clean.
        await page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' }).click();
        await expect(dirtyDot(page)).toBeVisible({ timeout: 10_000 });
        await runPaletteCommand(page, 'Save Project');
        await expect(dirtyDot(page)).toHaveCount(0, { timeout: 15_000 });

        // A second edit re-dirties — proving the clear was a real state change,
        // not a stuck-off indicator.
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });
        await page.getByRole('menuitem', { name: /^Duplicate Track$/ }).click();
        await expect(dirtyDot(page)).toBeVisible({ timeout: 10_000 });
    });
});
