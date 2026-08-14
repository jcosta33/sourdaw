import { test, expect, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// A 4-second sine WAV (~8 beats at 120 BPM) so the clip body is wide enough
// to grab and drag.
function buildSineWav(seconds = 4): Buffer {
    const sampleRate = 44100;
    const samples = Math.floor(sampleRate * seconds);
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i += 1) {
        buffer.writeInt16LE(Math.round((Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000)), 44 + i * 2);
    }
    return buffer;
}

async function addTrackViaPalette(page: Page): Promise<void> {
    const before = await trackArmButtons(page).count();
    await page.keyboard.press(`${MOD}+K`);
    const paletteInput = page.getByTestId('command-palette-input');
    await paletteInput.fill('Add Audio Track');
    await page.waitForTimeout(300);
    await paletteInput.press('Enter');
    // Assert the add landed here so a palette failure surfaces at the call
    // that caused it, not as an opaque timeout downstream.
    await expect(trackArmButtons(page)).toHaveCount(before + 1);
}

// The deviceChain spec's proven first-track flow: the empty state's MIDI
// Keys button, then select the row to reveal the inspector.
async function addMidiTrackFromEmptyState(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const midiRow = trackRows(page).filter({ hasText: /MIDI/i }).first();
    await midiRow.waitFor({ state: 'visible' });
    await midiRow.click();
    await page.waitForTimeout(300);
}

function trackRows(page: Page): Locator {
    return page.getByRole('grid', { name: /Track list/i }).first().getByRole('row');
}

// Each track nests two rows, so row counts are 2:1 with tracks; the arm
// button is one-per-track, so mutation round-trips count these. NB: an armed
// track relabels to "Disarm …" and drops out of /^Arm / — nothing arms tracks
// in these tests.
function trackArmButtons(page: Page): Locator {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
}

async function importClipOnFirstTrack(page: Page): Promise<Locator> {
    const rows = trackRows(page);
    await rows.first().click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    const fileChooser = await chooser;
    await fileChooser.setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: buildSineWav() });
    await page.waitForTimeout(2000);

    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.waitForTimeout(400);

    const canvas = page.getByLabel('Timeline editor surface');
    await canvas.click({ position: { x: 30, y: 20 } });
    await page.waitForTimeout(300);
    return canvas;
}

// Every mutation runs inside an Automerge transaction, so the CRDT history is
// the undo stack: each of these tests drives one major mutation class through
// a full undo → restored-state → redo → re-applied-state round-trip. Only
// clip-split and MIDI-draw had this before.
test.describe('Undo/redo round-trips of major mutations', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('track add → undo removes it → redo re-adds it', async ({ page }) => {
        // A fresh project has no tracks: anchor on the empty state so the
        // baseline is deterministic, not a hydration race.
        const emptyState = page.getByText('Add your first track');
        await expect(emptyState).toBeVisible();

        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');

        await addTrackViaPalette(page);
        const tracks = trackArmButtons(page);
        await expect(tracks).toHaveCount(1);
        await expect(undo).toBeEnabled();

        await undo.click();
        await expect(tracks).toHaveCount(0);
        await expect(emptyState).toBeVisible();

        await redo.click();
        await expect(tracks).toHaveCount(1);
    });

    test('track delete → undo restores it → redo re-deletes it', async ({ page }) => {
        await addTrackViaPalette(page);
        await addTrackViaPalette(page);
        const rows = trackArmButtons(page);
        await expect(rows).toHaveCount(2);

        // Right-click the second track's row via its arm button; the row's
        // context menu opens from it.
        await rows.nth(1).click({ button: 'right' });
        const deleteItem = page.getByRole('menuitem', { name: /Delete Track/i });
        await expect(deleteItem).toBeVisible();
        await deleteItem.click();
        const dialog = page.getByRole('dialog', { name: /Delete/i });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(rows).toHaveCount(1);

        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();

        await undo.click();
        await expect(rows).toHaveCount(2);

        await redo.click();
        await expect(rows).toHaveCount(1);
    });

    test('device add → undo removes the card → redo re-adds it', async ({ page }) => {
        // The inspector's add-device button appears on a selected track;
        // the empty state's MIDI Keys flow creates one.
        await addMidiTrackFromEmptyState(page);

        // The MIDI track's default synth already renders one device card, so
        // the round-trip is a delta off this pre-add baseline.
        const cards = page.locator('[data-testid^="device-card-"]');
        const baseline = await cards.count();

        await page.getByTestId('add-device-button').click();
        await page.waitForTimeout(300);
        await page.getByRole('menu').getByRole('menuitem').first().click();
        await expect(cards).toHaveCount(baseline + 1);

        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();

        await undo.click();
        await expect(cards).toHaveCount(baseline);

        await redo.click();
        await expect(cards).toHaveCount(baseline + 1);
    });

    test('clip drag move → undo restores the start beat → redo re-applies it', async ({ page }) => {
        await addTrackViaPalette(page);
        const canvas = await importClipOnFirstTrack(page);

        const startBeat = page.getByTestId('selected-clip-start-beat');
        await expect(startBeat).toHaveText(/@ 0 beats/i);

        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const startX = box!.x + 30;
        const y = box!.y + 20;
        await page.mouse.move(startX, y);
        await page.mouse.down();
        for (let step = 1; step <= 10; step += 1) {
            await page.mouse.move(startX + step * 15, y);
            await page.waitForTimeout(25);
        }
        await page.mouse.up();
        await page.waitForTimeout(800);
        await expect(startBeat).not.toHaveText(/@ 0 beats/i);

        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();

        await undo.click();
        await page.waitForTimeout(500);
        await expect(startBeat).toHaveText(/@ 0 beats/i);

        await redo.click();
        await page.waitForTimeout(500);
        await expect(startBeat).not.toHaveText(/@ 0 beats/i);
    });
});
