import { test, expect, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Navigates to the MIDI tab's "AI" sub-tab, which is where the generative
 * option grids live (the default "Patterns" sub-tab hosts PatternBrowser, and
 * the Audio tab shows the grids only when native audio generation is
 * available — never in a browser-run E2E session).
 */
async function openAiGenerationTab(page: Page): Promise<void> {
    await page.getByTestId('toggle-generate').click();
    await expect(page.getByTestId('generate-tab-midi')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByText('Describe the Music')).toBeVisible({ timeout: 5000 });
}

const gridOptions = (grid: Locator): Locator => grid.getByRole('button');

test.describe('Generate panel — generative option grids', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('option grids expose multiple selectable options on the MIDI AI sub-tab', async ({ page }) => {
        await openAiGenerationTab(page);

        const genreGrid = page.getByTestId('genre-grid');
        const moodGrid = page.getByTestId('mood-grid');
        const instrumentGrid = page.getByTestId('instrument-grid');

        await expect(genreGrid).toBeVisible();
        await expect(moodGrid).toBeVisible();
        await expect(instrumentGrid).toBeVisible();

        // Each grid renders its full option set (5 options per grid).
        await expect(gridOptions(genreGrid)).toHaveCount(5);
        await expect(gridOptions(moodGrid)).toHaveCount(5);
        await expect(gridOptions(instrumentGrid)).toHaveCount(5);
    });

    test('clicking a genre option flips its pressed state and enables generation', async ({ page }) => {
        await openAiGenerationTab(page);

        const generateMidi = page.getByRole('button', { name: 'Generate MIDI' });
        const loFi = page.getByTestId('genre-grid').getByRole('button', { name: 'Lo-Fi' });
        // The section's Clear button is rendered by ParamSection next to the
        // "Genre" label — a sibling of the grid, one level above it.
        const genreClear = page.getByTestId('genre-grid').locator('..').getByRole('button', { name: 'Clear' });

        // Nothing selected: option unpressed, clear affordance absent, generation disabled.
        await expect(loFi).toHaveAttribute('aria-pressed', 'false');
        await expect(genreClear).toHaveCount(0);
        await expect(generateMidi).toBeDisabled();

        await loFi.click();

        // Selection flips the pressed state, reveals the section's Clear button,
        // and satisfies the generate button's enable condition.
        await expect(loFi).toHaveAttribute('aria-pressed', 'true');
        await expect(genreClear).toBeVisible();
        await expect(generateMidi).toBeEnabled();

        // Clicking the selected option again deselects it (toggle contract).
        await loFi.click();
        await expect(loFi).toHaveAttribute('aria-pressed', 'false');
        await expect(genreClear).toHaveCount(0);
        await expect(generateMidi).toBeDisabled();
    });

    test('mood and instrument selections flip their own pressed states', async ({ page }) => {
        await openAiGenerationTab(page);

        const chill = page.getByTestId('mood-grid').getByRole('button', { name: 'Chill' });
        const drumKit = page.getByTestId('instrument-grid').getByRole('button', { name: 'Drum Kit' });

        await chill.click();
        await expect(chill).toHaveAttribute('aria-pressed', 'true');
        await expect(drumKit).toHaveAttribute('aria-pressed', 'false');

        await drumKit.click();
        await expect(drumKit).toHaveAttribute('aria-pressed', 'true');
        await expect(chill).toHaveAttribute('aria-pressed', 'true');
    });
});
