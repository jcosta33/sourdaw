import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

// Encode a MIDI variable-length quantity (used for delta-times and meta lengths).
function writeVlq(value: number): number[] {
    const bytes = [value & 0x7f];
    let rest = value >> 7;
    while (rest > 0) {
        bytes.unshift((rest & 0x7f) | 0x80);
        rest >>= 7;
    }
    return bytes;
}

// Build a minimal valid Standard MIDI File (Type 0, one track, one C4 quarter
// note at 120 BPM). Imported via the track context menu's "Import MIDI..."
// entry so the resulting clip carries real notes that exportMidiClip can read.
function buildMidBytes(): Buffer {
    const ticksPerBeat = 480;
    const note = 60; // C4
    const velocity = 100;

    // Track events: set-tempo (500000 µs/quarter = 120 BPM), note-on, note-off.
    const tempo = 500000;
    const tempoBytes = [(tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff];
    const events: number[] = [];
    // delta 0 — tempo meta
    events.push(...writeVlq(0), 0xff, 0x51, 0x03, ...tempoBytes);
    // delta 0 — note-on
    events.push(...writeVlq(0), 0x90, note, velocity);
    // delta ticksPerBeat — note-off
    events.push(...writeVlq(ticksPerBeat), 0x80, note, 0);
    // end of track
    events.push(...writeVlq(0), 0xff, 0x2f, 0x00);

    const trackData = Buffer.from(events);
    const mtrk = Buffer.from('MTrk', 'ascii');
    const trackLen = Buffer.alloc(4);
    trackLen.writeUInt32BE(trackData.length, 0);

    // Header chunk: format 0, 1 track, division.
    const header = Buffer.alloc(14);
    header.write('MThd', 0, 'ascii');
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8); // format 0
    header.writeUInt16BE(1, 10); // 1 track
    header.writeUInt16BE(ticksPerBeat, 12);

    return Buffer.concat([header, mtrk, trackLen, trackData]);
}

test.describe('MIDI clip export — .mid download', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('exporting a MIDI clip downloads a .mid file', async ({ page }) => {
        // Add a track so the context menu (and its Import MIDI entry) is reachable.
        await page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' }).click();
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        await trackList.getByRole('row').first().waitFor({ state: 'visible' });

        // Import a MIDI file so the track has a clip with real notes
        // (templates seed none, and exportMidiFile early-returns on empty clips).
        await trackList.getByRole('row').first().click({ button: 'right' });
        await page.getByRole('menu').waitFor({ state: 'visible' });

        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('menuitem', { name: /Import MIDI/i }).click();
        const fileChooser = await chooser;
        await fileChooser.setFiles({ name: 'riff.mid', mimeType: 'audio/midi', buffer: buildMidBytes() });
        await page.waitForTimeout(1500);

        // The import created a new MIDI track; its clip sits further down the
        // lane than the original track. Sweep positions to land the right-click
        // on the clip and open its context menu.
        const canvas = page.getByLabel('Timeline editor surface');
        let menuOpened = false;
        for (const pos of [
            { x: 30, y: 20 }, { x: 30, y: 50 }, { x: 30, y: 80 }, { x: 30, y: 110 },
            { x: 60, y: 20 }, { x: 60, y: 50 }, { x: 60, y: 80 }, { x: 60, y: 110 },
        ]) {
            await canvas.click({ button: 'right', position: pos });
            const exportItem = page.getByRole('menuitem', { name: /Export as MIDI/i }).first();
            if (await exportItem.isVisible().catch(() => false)) {
                // Clicking the item triggers a browser download.
                const downloadStarted = page.waitForEvent('download', { timeout: 15_000 });
                await exportItem.click();
                const download = await downloadStarted;
                expect(download.suggestedFilename()).toMatch(/\.mid$/i);
                menuOpened = true;
                break;
            }
            await page.keyboard.press('Escape').catch(() => undefined);
        }
        expect(menuOpened).toBe(true);
    });
});
