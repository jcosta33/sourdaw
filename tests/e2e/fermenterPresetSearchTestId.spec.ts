import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openFermenter(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('fermenter');
    await page.waitForTimeout(500);
    // The Fermenter card must be reachable; if it is not, the panel-open
    // contract is broken and the test must fail rather than silently skip.
    const card = page.getByRole('button', { name: /^Fermenter/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the Close control appears once FermenterPanel
    // has rendered, so wait on it instead of a fixed delay.
    await expect(page.getByRole('button', { name: /Close Fermenter/i }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Fermenter preset search', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('search narrows the Fermenter preset list and clearing restores it', async ({ page }) => {
        await openFermenter(page);

        const presetSearch = page.getByPlaceholder('Search presets…');
        await expect(presetSearch).toBeVisible({ timeout: 5000 });

        // The PresetBrowser footer renders a live "<n> presets" readout —
        // parse it before filtering to capture the unfiltered count.
        const footer = page.getByText(/^\d+ presets$/);
        await expect(footer).toBeVisible({ timeout: 5000 });
        const totalMatch = (await footer.textContent())?.match(/^(\d+) presets$/);
        expect(totalMatch).not.toBeNull();
        const totalCount = Number(totalMatch?.[1]);
        expect(totalCount).toBeGreaterThan(1);

        // "reese" matches only "Rye Reese" (name and its exclusive tag),
        // so the list must narrow to exactly that one preset.
        await presetSearch.fill('reese');
        await expect(footer).toHaveText(/^1 presets$/);
        await expect(page.getByRole('button', { name: /Rye Reese/i })).toBeVisible();

        // Clearing the query restores the full list.
        await presetSearch.fill('');
        await expect(footer).toHaveText(new RegExp(`^${totalCount} presets$`));
        await expect(page.getByRole('button', { name: /Rye Reese/i })).toBeVisible();
    });
});
