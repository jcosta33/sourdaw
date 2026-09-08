import { test, expect, type Page, type Locator } from '@playwright/test';

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

type Box = { height: number; width: number; x: number; y: number };

async function getBox(locator: Locator): Promise<Box> {
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error('Expected a rendered element box');
    }
    return box;
}

async function getVisibleHeight(locator: Locator): Promise<number> {
    return locator.evaluate((element) => {
        const elementRect = element.getBoundingClientRect();
        let top = Math.max(0, elementRect.top);
        let bottom = Math.min(window.innerHeight, elementRect.bottom);
        let parent = element.parentElement;

        while (parent) {
            const style = getComputedStyle(parent);
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
                const parentRect = parent.getBoundingClientRect();
                top = Math.max(top, parentRect.top);
                bottom = Math.min(bottom, parentRect.bottom);
            }
            parent = parent.parentElement;
        }

        return Math.max(0, bottom - top);
    });
}

async function expectUsableTimelineRow(canvas: Locator): Promise<void> {
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toBeInViewport();
    expect(await getVisibleHeight(canvas)).toBeGreaterThanOrEqual(80);
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

        // Both docks are open at the default 1280×720 browser viewport. The
        // arrangement must retain one usable track row rather than collapsing
        // the renderer while the editor keeps its protected minimum.
        const canvas = page.getByLabel('Timeline editor surface');
        const editorDock = page.getByRole('tabpanel').locator('..');
        const timelineBox = await getBox(canvas);
        const editorBox = await getBox(editorDock);
        expect(timelineBox.width).toBeGreaterThan(0);
        expect(timelineBox.height).toBeGreaterThanOrEqual(80);
        expect(editorBox.height).toBeGreaterThanOrEqual(280);

        // The center split owns the overflow. Reaching the keyboard must scroll
        // that split instead of clipping either dock out of the document.
        await keyboard.scrollIntoViewIfNeeded();
        await expect(keyboard).toBeInViewport();
        const centerScrollTop = await keyboard.evaluate((element) => {
            let parent = element.parentElement;
            while (parent) {
                if (getComputedStyle(parent).overflowY === 'auto') {
                    return parent.scrollTop;
                }
                parent = parent.parentElement;
            }
            return null;
        });
        expect(centerScrollTop).toBeGreaterThan(0);
        await expectUsableTimelineRow(canvas);

        // Edit: open the piano roll and stamp one more note into the clip —
        // a single click stamps (a double click stamps then hit-removes).
        await canvas.dblclick({ position: { x: 100, y: 40 } });
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        await expect(pianoRoll).toBeVisible({ timeout: 10_000 });
        const pianoRollBox = await getBox(pianoRoll);
        const notePosition = {
            x: Math.max(1, Math.min(200, Math.floor(pianoRollBox.width / 2))),
            y: Math.max(1, Math.min(130, Math.floor(pianoRollBox.height / 2))),
        };
        expect(notePosition.x).toBeLessThan(pianoRollBox.width);
        expect(notePosition.y).toBeLessThan(pianoRollBox.height);
        await pianoRoll.click({ position: notePosition });
        await expect(noteCount).toHaveText(`${recorded + 1} notes`, { timeout: 5000 });

        // Playback: the transport advances over the edited clip.
        await page.getByTestId('transport-play').click();
        const playhead = page.getByTestId('transport-playhead');
        await expect(playhead).not.toHaveText(/1\.1\.000/, { timeout: 10_000 });
        await page.getByTestId('transport-stop').click();
        await expect(playhead).toHaveText(/1\.1\.000/, { timeout: 5000 });

        // Removing pressure restores the stored 360px preference; restoring
        // pressure may shrink only the editor, never the timeline below its
        // complete-row minimum.
        await page.getByLabel('Close virtual keyboard').click();
        await expect(keyboard).toBeHidden();
        expect((await getBox(editorDock)).height).toBe(360);

        await page.getByTestId('toggle-virtual-keyboard').click();
        await keyboard.scrollIntoViewIfNeeded();
        const pressuredEditorBox = await getBox(editorDock);
        const pressuredTimelineBox = await getBox(canvas);
        expect(pressuredEditorBox.height).toBeGreaterThanOrEqual(280);
        expect(pressuredEditorBox.height).toBeLessThan(360);
        expect(pressuredTimelineBox.width).toBeGreaterThan(0);
        expect(pressuredTimelineBox.height).toBeGreaterThanOrEqual(80);
        await expectUsableTimelineRow(canvas);

        await page.setViewportSize({ width: 1280, height: 640 });
        await keyboard.scrollIntoViewIfNeeded();
        await expect(keyboard).toBeInViewport();
        expect((await getBox(editorDock)).height).toBeGreaterThanOrEqual(280);
        await expectUsableTimelineRow(canvas);

        await page.setViewportSize({ width: 1280, height: 900 });
        await expect.poll(async () => (await getBox(editorDock)).height).toBe(360);
        await expectUsableTimelineRow(canvas);

        const editorResizeHandle = editorDock.locator('xpath=preceding-sibling::*[1]');
        await expect(editorResizeHandle).toHaveAttribute('role', 'separator');
        const editorResizeHandleBox = await getBox(editorResizeHandle);
        await page.mouse.move(
            editorResizeHandleBox.x + editorResizeHandleBox.width / 2,
            editorResizeHandleBox.y + editorResizeHandleBox.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
            editorResizeHandleBox.x + editorResizeHandleBox.width / 2,
            editorResizeHandleBox.y + editorResizeHandleBox.height / 2 + 240,
            { steps: 4 }
        );
        await page.mouse.up();
        await expect.poll(async () => (await getBox(editorDock)).height).toBe(280);

        await page.getByLabel('Close virtual keyboard').click();
        await expect(keyboard).toBeHidden();
        expect((await getBox(editorDock)).height).toBe(280);

        await page.getByTestId('toggle-virtual-keyboard').click();
        await keyboard.scrollIntoViewIfNeeded();
        await expect(keyboard).toBeInViewport();
        expect((await getBox(editorDock)).height).toBe(280);
        await expectUsableTimelineRow(canvas);
    });
});
