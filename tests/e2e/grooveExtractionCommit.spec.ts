import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openBrowserPanel(page: Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
    }
    await expect(search).toBeVisible({ timeout: 10_000 });
}

async function openYeastPanel(page: Page): Promise<void> {
    await openBrowserPanel(page);
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();
    await browser.getByRole('button', { name: 'Yeast' }).click();
    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
}

async function drawNotes(page: Page): Promise<void> {
    // Create a MIDI clip via the track context menu, open the piano roll by
    // double-clicking the clip (the midiNoteVelocity pattern), then place
    // notes for the extractor.
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add Clip', exact: true }).click();
    await page.waitForTimeout(500);

    const canvas = page.getByLabel('Timeline editor surface');
    for (const pos of [
        { x: 100, y: 40 },
        { x: 200, y: 40 },
    ]) {
        await canvas.dblclick({ position: pos });
        await page.waitForTimeout(500);
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) {
            // A single click stamps a note (mousedown stashes a pending
            // stamp; mouse-up commits it). A DOUBLE click would stamp and
            // then hit-test-remove the fresh note — net zero notes.
            await pianoRoll.click({ position: { x: 80, y: 120 } });
            await page.waitForTimeout(200);
            await pianoRoll.click({ position: { x: 160, y: 140 } });
            await page.waitForTimeout(300);
            return;
        }
    }
    throw new Error('Piano roll did not open — no eligible MIDI clip can be created');
}

async function grooveTemplateOptions(page: Page): Promise<string[]> {
    const combobox = page.getByRole('combobox', { name: 'Groove template' });
    return combobox.locator('option').allTextContents();
}

// The groove extraction flow — preview an extracted template from a MIDI clip,
// commit it, then rename and delete it — has no E2E: 'groove' appears in E2E
// only under the Toaster specs.
test.describe('Yeast groove extraction — preview, commit, rename, delete', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        // A MIDI track with drawn notes gives the extractor an eligible clip.
        const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
        await emptyStateMidiButton.waitFor({ state: 'visible' });
        await emptyStateMidiButton.click();
        const trackList = page.getByRole('grid', { name: /Track list/i });
        await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor({ state: 'visible' });
        await drawNotes(page);
        await openYeastPanel(page);
        // Groove is a level-3 processor: its sprout-shelf chip lives on the
        // Build deck. Adding it collapses to a rack row; expanding that row
        // mounts the params (template combobox, lifecycle controls) and the
        // extraction UI beside them.
        await page.getByRole('button', { name: /Build/ }).click();
        await page.getByRole('button', { name: '+ Groove' }).click();
        // The added processor collapses to a rack row ('1 ▶ Groove' in a
        // span; the deck header's div also says Groove); expanding the rack
        // row mounts its params.
        const grooveRow = page.locator('span', { hasText: 'Groove' }).last();
        await expect(grooveRow).toBeVisible({ timeout: 10_000 });
        await grooveRow.click();
        await expect(page.getByRole('combobox', { name: 'Groove template' })).toBeVisible();
    });

    test('committing an extracted template adds, renames, and deletes it', async ({ page }) => {
        const combobox = page.getByRole('combobox', { name: 'Groove template' });
        const before = await grooveTemplateOptions(page);

        // Preview: the notes were drawn into whichever clip the piano roll
        // opened — try each option until one extracts (bounded by the
        // dropdown's own length; an empty clip reports 'no notes').
        const clipSelect = page.getByRole('combobox', { name: 'MIDI clip for groove extraction' });
        const optionCount = await clipSelect.locator('option').count();
        expect(optionCount).toBeGreaterThan(1);
        const status = page.locator('[role="status"]').filter({ hasText: /groove|straight|clip/i }).first();
        let message = '';
        for (let index = 1; index < optionCount; index += 1) {
            await clipSelect.selectOption({ index });
            await page.getByRole('button', { name: 'Preview groove' }).click();
            await expect(status).toBeVisible({ timeout: 10_000 });
            message = await status.innerText();
            if (!/no notes|empty/i.test(message)) {
                break;
            }
        }
        expect(message).not.toMatch(/no notes|empty/i);

        // A straight (already-on-grid) clip extracts to the straight template
        // and has nothing to save; an extracted groove offers Save.
        if (/straight|already/i.test(message)) {
            await expect(page.getByRole('button', { name: 'Save groove' })).toHaveCount(0);
            return;
        }
        await expect(page.getByRole('button', { name: 'Save groove' })).toBeVisible();

        // Commit: the template list gains exactly the extracted template.
        await page.getByRole('button', { name: 'Save groove' }).click();
        await expect(page.getByRole('button', { name: 'Save groove' })).toHaveCount(0, { timeout: 10_000 });
        const after = await grooveTemplateOptions(page);
        const added = after.filter((text) => !before.includes(text));
        expect(added).toHaveLength(1);

        // Select the new template: the lifecycle controls show its name.
        await combobox.selectOption({ label: added[0]! });
        const nameInput = page.getByRole('textbox', { name: 'Groove template name' });
        await expect(nameInput).toHaveValue(added[0]!);

        // Rename: the option list reflects the new name.
        await nameInput.fill('Renamed groove');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('option', { name: added[0]!, exact: true })).toHaveCount(0);

        // Delete: the option disappears.
        await page.getByRole('button', { name: 'Delete template' }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toHaveCount(0, { timeout: 10_000 });
    });
});
