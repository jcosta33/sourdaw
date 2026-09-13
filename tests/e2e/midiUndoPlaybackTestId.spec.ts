import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

async function openPianoRollOnNewClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    await timeline.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

async function paintOneNote(page: Page): Promise<void> {
    const pianoRoll = page.getByLabel('Piano roll editor');
    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    const noteCount = page.getByTestId('selected-clip-note-count');

    await expect(noteCount).toHaveText('0 notes');
    await expect(paint).toHaveAttribute('aria-pressed', 'false');
    await paint.click();
    await expect(paint).toHaveAttribute('aria-pressed', 'true');
    await pianoRoll.click({ position: { x: 200, y: 130 } });
    await expect(noteCount).toHaveText('1 note');
}

test.describe('MIDI piano-roll editing and playback on a new clip', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120_000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('painting a note changes the selected clip count through undo and redo', async ({ page }) => {
        const noteCount = page.getByTestId('selected-clip-note-count');
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });

        await paintOneNote(page);
        await expect(undo).toBeEnabled();

        await undo.click();
        await expect(noteCount).toHaveText('0 notes');
        await expect(redo).toBeEnabled();

        await redo.click();
        await expect(noteCount).toHaveText('1 note');
    });

    test('playback advances after inserting a MIDI note and stop returns to the start', async ({ page }) => {
        const play = page.getByTestId('transport-play');
        const stop = page.getByTestId('transport-stop');
        const playhead = page.getByTestId('transport-playhead');

        await paintOneNote(page);
        await play.click();
        await expect.poll(async () => (await playhead.innerText()).trim()).not.toMatch(/1\.1\.000/);

        await stop.click();
        await expect(playhead).toHaveText(/1\.1\.000/);
    });

    test('step input inserts a note from the focused piano-roll keyboard shortcut', async ({ page }) => {
        const pianoRoll = page.getByLabel('Piano roll editor');
        const step = page.getByRole('button', { name: 'Toggle step input mode' });
        const noteCount = page.getByTestId('selected-clip-note-count');

        await expect(noteCount).toHaveText('0 notes');
        await step.click();
        await expect(step).toHaveAttribute('aria-pressed', 'true');
        await pianoRoll.focus();
        await page.keyboard.press('Control+Space');
        await expect(noteCount).toHaveText('1 note');
    });

    test('fold and constrain remain enabled while painting a note', async ({ page }) => {
        const fold = page.getByRole('button', { name: 'Toggle fold to scale' });
        const constrain = page.getByRole('button', { name: 'Constrain notes to scale' });

        await fold.click();
        await constrain.click();
        await expect(fold).toHaveAttribute('aria-pressed', 'true');
        await expect(constrain).toHaveAttribute('aria-pressed', 'true');
        await paintOneNote(page);
    });
});
