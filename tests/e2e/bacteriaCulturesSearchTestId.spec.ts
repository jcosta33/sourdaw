import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Bacteria cultures search: the preset rail's "Search cultures" input filters
// BACTERIA_PRESETS by name/category (case-insensitive substring) and the rail
// header LED reports "<filtered> shown". "Tube" matches only "Tube Crunch".
test.describe('Bacteria cultures search — narrows list, clear restores', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Bacteria$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Bacteria/i })).toBeVisible();
        await inspector.getByText('Bacteria', { exact: false }).first().click();
        await page.waitForTimeout(800);
        await expect(page.getByPlaceholder('Search cultures')).toBeVisible();
    });

    test('filling a narrow query drops the shown count; clearing restores it', async ({ page }) => {
        const search = page.getByPlaceholder('Search cultures');
        const shown = page.getByText(/^\d+ shown$/);

        // Baseline: every culture is listed (BACTERIA_PRESETS has 15 entries).
        const baseline = Number.parseInt((await shown.innerText()).trim(), 10);
        expect(baseline).toBeGreaterThanOrEqual(2);

        // Narrow: "Tube" matches only the "Tube Crunch" culture.
        await search.fill('Tube');
        await expect(shown).toHaveText('1 shown');
        await expect(page.getByRole('button', { name: /Tube Crunch/i })).toBeVisible();

        // Clear: the full list is restored.
        await search.fill('');
        await expect(shown).toHaveText(`${baseline} shown`);
        await expect(page.getByRole('button', { name: /Tube Crunch/i })).toBeVisible();
    });
});
