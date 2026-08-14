import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// AiGeneration PatternBrowser search depth. The pattern search input
// (aria-label="Search MIDI patterns", PatternBrowser.tsx) narrows the template
// grid via `filterTemplates` (name/description/tags/genres, case-insensitive),
// but the #1642 spec (aiGenerationPatternTestId.spec.ts) only covers pattern
// INSERT — no E2E asserts that searching actually filters the pattern list and
// that clearing restores it.
test.describe('AiGeneration — pattern search filters the pattern list', () => {
    test('a narrow query drops the pattern card count and clearing restores it', async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);

        // Open the Generate panel (aria-pressed toggle, PanelToggles.tsx). It
        // opens on the MIDI tab → Patterns sub-tab by default, so
        // PatternBrowser is already mounted — no tab navigation needed.
        const generate = page.getByRole('button', { name: 'Generate', exact: true });
        await generate.click();

        // Wait on the search input directly: it is present only once
        // PatternBrowser has mounted.
        const patternSearch = page.getByLabel('Search MIDI patterns');
        await expect(patternSearch).toBeVisible({ timeout: 10_000 });

        // Each pattern card renders an "Insert <name> at playhead" button —
        // one per template in the filtered grid.
        const insertButtons = page.getByRole('button', { name: /^Insert / });

        // Baseline: the full factory library (54 templates across chords,
        // bass, drums, melody) is listed.
        await expect(insertButtons.first()).toBeVisible({ timeout: 10_000 });
        const baselineCount = await insertButtons.count();
        expect(baselineCount).toBeGreaterThanOrEqual(2);

        // "blues" matches a narrow slice of the library — 12-Bar Blues
        // (chords), Blues Shuffle (drums), Blues Lick (melody) — and no other
        // template name contains it, so the grid must shrink.
        await patternSearch.fill('blues');
        await expect(insertButtons.first()).toBeVisible({ timeout: 10_000 });
        const filteredCount = await insertButtons.count();
        expect(filteredCount).toBeLessThan(baselineCount);

        // The surviving cards are the blues matches themselves — a
        // non-blues template is gone from the grid. Card identity lives in the
        // Insert button's accessible name (`Insert <name> at playhead`).
        await expect(page.getByRole('button', { name: /^Insert 12-Bar Blues at playhead$/i })).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Insert 4-on-the-Floor at playhead/i })).toHaveCount(0);

        // Clearing the query restores the full list.
        await patternSearch.fill('');
        await expect(page.getByRole('button', { name: /Insert 4-on-the-Floor at playhead/i })).toHaveCount(1);
        expect(await insertButtons.count()).toBe(baselineCount);
    });
});
