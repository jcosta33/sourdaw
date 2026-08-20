import { expect, test, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
    await trackList.getByText('MIDI', { exact: true }).click();
}

async function midiLaneY(page: Page): Promise<number> {
    const canvas = page.getByLabel('Timeline editor surface');
    const muteBox = await page.getByRole('button', { name: 'Mute MIDI' }).boundingBox();
    const canvasBox = await canvas.boundingBox();
    if (!muteBox || !canvasBox) {
        throw new Error('Mute MIDI or timeline surface has no bounding box');
    }
    return Math.min(Math.max(muteBox.y - canvasBox.y + muteBox.height / 2, 8), canvasBox.height - 8);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openPianoRollOnNewClip(page: Page): Promise<Locator> {
    await addMidiTrack(page);
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    const y = await midiLaneY(page);
    await canvas.click({ button: 'right', position: { x: 300, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    await openBottomTab(page, 'Editor');
    return pianoRoll;
}

test.describe('Transport toggles — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('auto-scroll toggle round-trips aria-pressed via test ID', async ({ page }) => {
        const autoScroll = page.getByRole('button', { name: 'Auto-scroll follows playhead' });
        await expect(autoScroll).toBeVisible();
        await expect(autoScroll).toHaveAttribute('data-testid', 'transport-auto-scroll');
        await expect(autoScroll).toHaveAttribute('aria-pressed', 'true');
        await expect(autoScroll).toHaveAttribute('data-variant', 'secondary');

        await autoScroll.click();
        await expect(autoScroll).toHaveAttribute('aria-pressed', 'false');
        await expect(autoScroll).toHaveAttribute('data-variant', 'ghost');

        await autoScroll.click();
        await expect(autoScroll).toHaveAttribute('aria-pressed', 'true');
        await expect(autoScroll).toHaveAttribute('data-variant', 'secondary');
    });

    test('undo and redo buttons are present via test IDs', async ({ page }) => {
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });

        await expect(undo).toHaveAttribute('data-testid', 'transport-undo');
        await expect(redo).toHaveAttribute('data-testid', 'transport-redo');
        await expect(undo).toBeDisabled();
        await expect(redo).toBeDisabled();
    });

    test('undo restores zero notes after painting a MIDI note', async ({ page }) => {
        const pianoRoll = await openPianoRollOnNewClip(page);
        const noteCount = page.getByTestId('selected-clip-note-count');
        await expect(noteCount).toHaveText('0 notes');

        const paint = page.getByRole('button', { name: 'Toggle paint mode' });
        if ((await paint.getAttribute('aria-pressed')) !== 'true') {
            await paint.click();
        }
        await expect(paint).toHaveAttribute('aria-pressed', 'true');
        await pianoRoll.click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText('1 note');

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(noteCount).toHaveText('0 notes');
    });
});
