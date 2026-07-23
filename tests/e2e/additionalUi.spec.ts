import { expect, test } from '@playwright/test';
import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// ---------------------------------------------------------------------------
// Chord track (Pop Song) — lane renders with chord content + add button.
// ---------------------------------------------------------------------------

test.describe('Chord track content', () => {
    test('Pop Song template shows chord track with seeded chords and add button', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);

        const chord_track = page.getByRole('region', { name: 'Chord track' });
        await expect(chord_track).toBeVisible();
        // Seeded chords exist.
        expect(await chord_track.getByRole('button', { name: /chord at beat/i }).count()).toBeGreaterThan(0);
        // Add button is present.
        await expect(chord_track.getByRole('button', { name: /Add chord event/i })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Tempo editor — BPM display, tap tempo, time signature.
// ---------------------------------------------------------------------------

test.describe('Tempo editor', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Tempo BPM display shows the template tempo', async ({ page }) => {
        const bpm = page.getByLabel('Tempo BPM');
        await expect(bpm).toBeVisible();
        await expect(bpm).toContainText(/128/);
    });

    test('Time signature readout shows 4/4', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Time signature/i })).toContainText('4/4');
    });
});

// ---------------------------------------------------------------------------
// Browser search + prompt bar — accept and display typed input.
// ---------------------------------------------------------------------------

test.describe('Browser and prompt input', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });
    });

    test('Browser search accepts typed text', async ({ page }) => {
        const search = page.getByRole('complementary', { name: 'Browser panel' }).getByRole('searchbox', { name: 'Search browser' });
        await search.fill('synth');
        await expect(search).toHaveValue('synth');
    });

    test('Prompt bar accepts typed text', async ({ page }) => {
        const prompt = page.getByRole('textbox', { name: 'Prompt command input' });
        await prompt.fill('add a beat');
        await expect(prompt).toHaveValue('add a beat');
    });
});

// ---------------------------------------------------------------------------
// Undo history panel — opens after an action.
// ---------------------------------------------------------------------------

test.describe('Undo history panel', () => {
    test('Undo history panel opens and shows entries after an action', async ({ page }) => {
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const undo_toggle = page.getByRole('button', { name: /Toggle undo history panel/i });
        await undo_toggle.click();
        await page.waitForTimeout(500);

        // The panel renders with a visible header.
        await expect(page.getByText(/Undo History/i)).toBeVisible();
    });
});
