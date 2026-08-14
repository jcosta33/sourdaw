import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { launch_from_template, setupWorkspace } from './e2eUtils';

// A small bundled WAV fixture — imported through the Browser's file input so a
// real sample row with a favorite toggle exists for the Imported-subtab test.
const SAMPLE_FIXTURE = fileURLToPath(
    new URL('../../public/samples/levain/clarinet/DCClar_stac_F2_v1_rr1_sum.wav', import.meta.url)
);
const SAMPLE_NAME = 'DCClar_stac_F2_v1_rr1_sum';

/**
 * Open the Browser panel and select the Library tab. The Library tab defaults
 * to its "Folders" sub-tab, which renders the SampleLibrary LibraryBrowser
 * (Connect Folder / Search library / Show favorites only header controls).
 */
async function openLibraryTab(page: Page): Promise<void> {
    const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
    if (!(await browserPanel.isVisible())) {
        await page.getByRole('button', { name: /Toggle browser/i }).click();
        await expect(browserPanel).toBeVisible();
    }
    await browserPanel.getByRole('button', { name: 'Library', exact: true }).click();
    // The Folders sub-tab is the default; its presence confirms the Library tab
    // is mounted.
    await expect(browserPanel.getByRole('button', { name: 'Folders', exact: true })).toBeVisible();
}

test.describe('Sample Library favorites', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Library Folders view: favorites-only toggle flips pressed state, favorite flips row label, search narrows rows', async ({
        page,
    }) => {
        await openLibraryTab(page);
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });

        // The Library ships a seeded "Factory Samples" root whose files live in
        // nested single-file folders. Searching from the root flattens every
        // matching sample across the whole root into role="option" rows.
        const searchToggle = browserPanel.getByRole('button', { name: 'Search library' });
        await expect(searchToggle).toHaveAttribute('aria-pressed', 'false');
        await searchToggle.click();
        await expect(searchToggle).toHaveAttribute('aria-pressed', 'true');

        const searchInput = browserPanel.getByPlaceholder('Search samples...');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('808');

        // The factory seed registers all records in one shot; the first boot may
        // still be synthesizing, so allow a generous bound for the first row.
        const options = browserPanel.locator('[role="option"]');
        await expect(options.first()).toBeVisible({ timeout: 20_000 });
        const initialRowCount = await options.count();
        expect(initialRowCount).toBeGreaterThan(1);

        // The first row's favorite star starts in its "Add" state; clicking it
        // flips the same button to the "Remove" state.
        const firstRow = options.first();
        const firstName = ((await firstRow.getAttribute('aria-label')) ?? '').replace(/^Sample /, '');
        const addFavorite = firstRow.getByRole('button', { name: `Add ${firstName} to favorites` });
        await expect(addFavorite).toBeVisible();
        await addFavorite.click();
        const removeFavorite = firstRow.getByRole('button', { name: `Remove ${firstName} from favorites` });
        await expect(removeFavorite).toBeVisible();
        await expect(addFavorite).toHaveCount(0);
        await expect(firstRow).toHaveAttribute('aria-label', `Sample ${firstName}, favorite`);

        // Favorites-only filtering: pressing the toggle narrows the list to
        // exactly the one favorited row.
        const favoritesToggle = browserPanel.getByRole('button', { name: 'Show favorites only' });
        await expect(favoritesToggle).toHaveAttribute('aria-pressed', 'false');
        await favoritesToggle.click();
        await expect(favoritesToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(options).toHaveCount(1);

        // Search narrows the row list while the favorites-only filter stays on:
        // a query matching the favorited sample keeps it, a non-matching query
        // empties the list, and the toggle's pressed state is unaffected.
        await searchInput.fill(firstName);
        await expect(options).toHaveCount(1);

        await searchInput.fill('zzz-no-such-sample');
        await expect(options).toHaveCount(0);
        await expect(favoritesToggle).toHaveAttribute('aria-pressed', 'true');

        // Toggle the filter back off so store state is left untouched.
        await favoritesToggle.click();
        await expect(favoritesToggle).toHaveAttribute('aria-pressed', 'false');
    });

    test('Imported sample row: favorite toggle flips its label, search narrows the row list', async ({ page }) => {
        await openLibraryTab(page);
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });

        // The "Imported" sub-tab renders the SamplesTab list. Import a real WAV
        // through the hidden file input so exactly one sample row exists.
        await browserPanel.getByRole('button', { name: 'Imported', exact: true }).click();
        const fileInput = browserPanel.locator('input[type="file"]');
        await fileInput.setInputFiles(SAMPLE_FIXTURE);

        const sampleRow = browserPanel.getByText(SAMPLE_NAME, { exact: true });
        await expect(sampleRow).toBeVisible();
        await expect(browserPanel.getByText('1 samples')).toBeVisible();

        // The row's favorite star starts in its "Add" state; clicking flips the
        // same button to the "Remove" state.
        const addFavorite = browserPanel.getByRole('button', { name: 'Add to favorites' });
        await expect(addFavorite).toBeVisible();
        await expect(browserPanel.getByRole('button', { name: 'Remove from favorites' })).toHaveCount(0);

        await addFavorite.click();

        const removeFavorite = browserPanel.getByRole('button', { name: 'Remove from favorites' });
        await expect(removeFavorite).toBeVisible();
        await expect(addFavorite).toHaveCount(0);

        // Flip it back so the persisted sidebar favorites stay empty for later
        // assertions in this test.
        await removeFavorite.click();
        await expect(addFavorite).toBeVisible();

        // The panel search narrows the row list: a matching query keeps the row,
        // a non-matching query empties it.
        const search = browserPanel.getByLabel('Search browser');
        await search.fill(SAMPLE_NAME);
        await expect(sampleRow).toBeVisible();

        await search.fill('zzz-no-such-sample');
        await expect(sampleRow).toHaveCount(0);
        await expect(browserPanel.getByText('0 samples')).toBeVisible();
    });

    test('Instruments preset favorite toggle flips its label', async ({ page }) => {
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browserPanel.isVisible())) {
            await page.getByRole('button', { name: /Toggle browser/i }).click();
            await expect(browserPanel).toBeVisible();
        }

        // Instruments is the Browser's default tab. Searching from its root
        // flattens matching factory presets into PresetItem rows, each with a
        // favorite star.
        await browserPanel.getByRole('button', { name: 'Instruments', exact: true }).click();
        await browserPanel.getByLabel('Search browser').fill('synth');

        const addFavorite = browserPanel.getByRole('button', { name: 'Add to favorites' });
        await expect(addFavorite.first()).toBeVisible();

        // A fresh workspace has no favorited presets.
        const removeFavorite = browserPanel.getByRole('button', { name: 'Remove from favorites' });
        await expect(removeFavorite).toHaveCount(0);

        const initialAddCount = await addFavorite.count();
        await addFavorite.first().click();

        // Exactly one preset's star flipped to the "Remove" state.
        await expect(removeFavorite).toHaveCount(1);
        await expect(addFavorite).toHaveCount(initialAddCount - 1);

        // Flip it back so the persisted favorites set stays empty.
        await removeFavorite.first().click();
        await expect(removeFavorite).toHaveCount(0);
        await expect(addFavorite).toHaveCount(initialAddCount);
    });
});
