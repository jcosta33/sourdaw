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
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
}

test.describe('Chord stamp', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await openPianoRollOnNewClip(page);
    });

    test('stamping the default major chord writes three notes', async ({ page }) => {
        const pianoRoll = page.getByLabel('Piano roll editor');
        const noteCount = page.getByLabel(/notes? in /i);
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode', exact: true });

        await expect(noteCount).toHaveText('0 notes');
        await chord.click();
        await expect(chord).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('combobox', { name: 'Chord type', exact: true })).toHaveValue('major');

        await pianoRoll.click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText('3 notes');
    });

    test('selecting min7 then stamping writes four notes', async ({ page }) => {
        const pianoRoll = page.getByLabel('Piano roll editor');
        const noteCount = page.getByLabel(/notes? in /i);
        const chord = page.getByRole('button', { name: 'Toggle chord stamp mode', exact: true });
        const chordType = page.getByRole('combobox', { name: 'Chord type', exact: true });

        await expect(noteCount).toHaveText('0 notes');
        await chord.click();
        await chordType.selectOption('min7');
        await expect(chordType).toHaveValue('min7');

        await pianoRoll.click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText('4 notes');
    });
});
