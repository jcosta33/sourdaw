import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addMidiTrack(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor();
}

async function openEditorDock(page: Page): Promise<void> {
    const dockToggle = page.getByTestId('toggle-bottom-dock');
    if ((await dockToggle.getAttribute('aria-pressed')) !== 'true') {
        await dockToggle.click();
        await page.waitForTimeout(400);
    }
    await page.getByRole('tab', { name: 'Editor' }).click();
}

// The record→edit→playback chain, with the virtual keyboard as the MIDI
// source. Recording alone is covered (arm/record toggles); no spec records,
// edits the resulting clip, and plays back. Note capture is asserted through
// the dock's live note-count readout — clip bookkeeping alone cannot tell a
// recorded clip from an empty one (record start creates the clip
// unconditionally).
test.describe('Record, edit, playback — MIDI clip lifecycle', () => {
    test('recording keyboard input creates a clip that survives an edit and plays back', async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);

        // Open the on-screen keyboard — the E2E stand-in for a MIDI input.
        await page.getByTestId('toggle-virtual-keyboard').click();
        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible({ timeout: 10_000 });

        // Arm + record: recording auto-starts the transport — an explicit
        // play click would PAUSE (and finalize) the recording before any
        // note lands.
        await page.locator('[data-testid^="track-arm-"]').first().click();
        const record = page.getByTestId('transport-record');
        await record.click();
        await expect(record).toHaveAttribute('aria-pressed', 'true');

        // Play a few notes: pointerdown/up pairs on labeled keys. The white
        // keys carry letter names ('C4') in their accessible labels; role
        // name-matching works where text filtering does not (the keys'
        // innerText is empty for most).
        const keys = keyboard.getByRole('button', { name: /MIDI \d+|C-?\d/ });
        await expect(keys.nth(20)).toBeVisible();
        const playedKeys = (await keys.all()).slice(18, 26);
        for (const key of playedKeys) {
            await key.click();
            await page.waitForTimeout(150);
        }

        await page.getByTestId('transport-stop').click();
        await expect(page.getByTestId('transport-playhead')).toHaveText(/1\.1\.000/, { timeout: 5000 });

        // The recording captured the played notes — the live note-count
        // readout, not the clip count (which record start creates empty).
        await openEditorDock(page);
        const noteCount = page.getByTestId('selected-clip-note-count');
        await expect(noteCount).toBeVisible({ timeout: 10_000 });
        const recorded = Number((await noteCount.innerText()).match(/\d+/)?.[0] ?? '0');
        expect(recorded).toBeGreaterThanOrEqual(playedKeys.length);

        // Edit: open the piano roll and stamp one more note into the clip —
        // a single click stamps (a double click stamps then hit-removes).
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.dblclick({ position: { x: 100, y: 40 } });
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible({ timeout: 10_000 });
        await pianoRoll.click({ position: { x: 200, y: 130 } });
        await expect(noteCount).toHaveText(`${recorded + 1} notes`, { timeout: 5000 });

        // Playback: the transport advances over the edited clip.
        await page.getByTestId('transport-play').click();
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).not.toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });
    });
});
