import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// Opens the Grinder panel from the inspector: add an Audio track, insert a
// Grinder device through the Add-device menu, then double-click the device
// card to expand its panel (path mirrored from devicePanels.spec.ts).
async function openGrinderPanel(page: import('@playwright/test').Page): Promise<void> {
    const addAudioButton = page
        .locator('button')
        .filter({ hasText: 'Audio' })
        .filter({ hasText: 'Record or import' });
    await addAudioButton.waitFor({ state: 'visible' });
    await addAudioButton.click();

    const addDeviceButton = page.getByLabel('Add device');
    await expect(addDeviceButton).toBeVisible();
    await addDeviceButton.click();

    const grinderItem = page.getByRole('menuitem', { name: /Grinder/i });
    await grinderItem.waitFor({ state: 'visible' });
    await grinderItem.click();

    const grinderBypass = page.getByRole('button', { name: 'Bypass Grinder' });
    await expect(grinderBypass).toBeVisible();

    const grinderCard = page.getByText('Grinder', { exact: true });
    await grinderCard.dblclick();

    const closePanel = page.getByRole('button', { name: 'Close Grinder' });
    await expect(closePanel).toBeVisible({ timeout: 10_000 });
}

// Grinder preset search depth. The search input (aria-label="Search Grinder
// presets", GrinderPanel.tsx BrowserRail) is only value-round-tripped in
// devicePanels.spec.ts — no E2E asserts the preset list actually narrows and
// restores.
test.describe('Grinder preset search — filtering narrows the preset list', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openGrinderPanel(page);
    });

    test('a narrow query drops the shown count to its matches and clearing restores the list', async ({ page }) => {
        const presetSearch = page.getByLabel('Search Grinder presets');
        await expect(presetSearch).toBeVisible({ timeout: 10_000 });

        // Preset entry buttons live in the BrowserRail aside; the rail also
        // renders a computed "N shown" readout next to the category label.
        const shownReadout = page.getByText(/^[0-9]+ shown$/);
        await expect(shownReadout).toBeVisible({ timeout: 10_000 });

        // Baseline: every factory preset is listed.
        const before = await shownReadout.textContent();
        const beforeCount = Number.parseInt(before ?? '0', 10);
        expect(beforeCount).toBeGreaterThanOrEqual(2);

        // "metal" matches a single factory preset — Modern Metal (name and
        // category both contain it, and no other preset does).
        await presetSearch.fill('metal');
        await expect(shownReadout).toHaveText('1 shown');
        // Preset buttons expose name + category + amp label as their accessible
        // name and the amp lineup below also sells a "Clean Twin" — so scope to
        // the preset entry buttons (grinder-window class; amp rows don't carry
        // it) and match on the preset-name substring.
        const presetButtons = page.locator('aside button.grinder-window');
        await expect(presetButtons.filter({ hasText: 'Modern Metal' })).toBeVisible();
        await expect(presetButtons.filter({ hasText: 'Clean Twin' })).toHaveCount(0);

        // Clearing the query restores the full list.
        await presetSearch.fill('');
        await expect(shownReadout).toHaveText(`${beforeCount} shown`);
        await expect(presetButtons.filter({ hasText: 'Clean Twin' })).toBeVisible();
    });
});
