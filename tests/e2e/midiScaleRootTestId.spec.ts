import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The 12 pitch-class names the toolbar's scale-root `<select>` lists as option
 * text (mirrors `KEY_NAMES` in `src/utils/Music/MusicalScale.ts`). Duplicated
 * locally so the e2e test does not cross into app source.
 */
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Open the piano roll deterministically: add a MIDI track from the empty-state,
 * right-click its timeline lane → "Add Clip Here", then double-click the clip.
 * This is the proven open path from `pianoRollScaleTestId.spec.ts`. Asserts the
 * editor mounts (no vacuous early-return) so a missed open fails the test.
 */
async function openPianoRoll(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });

    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await page.waitForTimeout(500);

    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.locator('[aria-label="Piano roll editor"]')).toBeVisible();
    await page.waitForTimeout(500);
}

/** Read the human-visible readout of the scale-root select (the selected option's label text). */
async function rootReadout(page: Page): Promise<string> {
    const select = page.getByTestId('toolbar-scale-root');
    // The visible readout is the selected option's label text. Resolve the
    // selected option via the select's value (the root index), then read it.
    const selectedIndex = Number(await select.inputValue());
    const text = await select.locator('option').nth(selectedIndex).textContent();
    return text ?? '';
}

/** True when the option at `index` is the selected (active) option of the root select. */
async function rootOptionIsActive(page: Page, index: number): Promise<boolean> {
    const select = page.getByTestId('toolbar-scale-root');
    return select
        .locator('option')
        .nth(index)
        .evaluate((option: HTMLOptionElement) => option.selected);
}

/**
 * Collect the pitch-class names rendered in the folded keyboard sidebar. With
 * fold-to-scale ON these are exactly the in-scale degrees, so the set is a
 * function of (scaleType, root) and shifts when the root changes.
 */
async function visibleKeyNoteNames(page: Page): Promise<Set<string>> {
    const keyLabels = page.getByText(/^[A-G]#?\d+$/);
    await expect(keyLabels.first()).toBeVisible();
    const labels = await keyLabels.allTextContents();
    return new Set(
        labels.map((label) => {
            const match = label.match(/^([A-G]#?)/);
            return match !== null ? match[1] : label;
        })
    );
}

test.describe('MIDI scale ROOT selector — depth', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openPianoRoll(page);
    });

    test('selecting a different root updates the readout and the active option', async ({ page }) => {
        const select = page.getByTestId('toolbar-scale-root');
        await expect(select).toBeVisible({ timeout: 5000 });

        const beforeIndex = Number(await select.inputValue());
        const targetIndex = (beforeIndex + 2) % 12;

        const beforeReadout = await rootReadout(page);
        expect(beforeReadout).toBe(KEY_NAMES[beforeIndex]);

        await select.selectOption({ index: targetIndex });
        await page.waitForTimeout(200);

        // Readout: the visible selected label reflects the new root.
        const afterReadout = await rootReadout(page);
        expect(afterReadout).toBe(KEY_NAMES[targetIndex]);
        expect(afterReadout).not.toBe(beforeReadout);

        // Active-option state: the option at the target index is now the selected one.
        expect(await rootOptionIsActive(page, targetIndex)).toBe(true);
        expect(await rootOptionIsActive(page, beforeIndex)).toBe(false);
    });

    test('changing the root with fold-to-scale shifts the in-scale keyboard rows', async ({ page }) => {
        const rootSelect = page.getByTestId('toolbar-scale-root');
        const typeSelect = page.getByTestId('toolbar-scale-type');
        await expect(rootSelect).toBeVisible({ timeout: 5000 });

        // The default scale type is chromatic, for which folding shows every
        // pitch class regardless of root. Pick a heptatonic scale so the folded
        // keyboard only renders the seven in-scale degrees that depend on root.
        await typeSelect.selectOption('major');
        await page.waitForTimeout(200);

        // Enable fold-to-scale so the keyboard only shows in-scale degrees.
        const fold = page.getByTestId('toolbar-fold-to-scale');
        await fold.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');

        const beforeIndex = Number(await rootSelect.inputValue());
        const beforeNames = await visibleKeyNoteNames(page);

        // Move the root by a fourth (+5 semitones): always a distinct scale-degree set.
        const targetIndex = (beforeIndex + 5) % 12;
        await rootSelect.selectOption({ index: targetIndex });
        await page.waitForTimeout(300);

        const afterNames = await visibleKeyNoteNames(page);

        // The root propagated through getVisiblePitches: the in-scale note set changed.
        expect(Array.from(afterNames).sort()).not.toEqual(Array.from(beforeNames).sort());
        // The new root is itself a scale degree, so it must appear in the folded rows.
        expect(afterNames.has(KEY_NAMES[targetIndex])).toBe(true);
    });
});
