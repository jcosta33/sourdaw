import { env } from 'node:process';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { buildSineWav } from './audioClipFixture';
import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';

async function snapshot(page: Page) {
    return page.evaluate(async (entry) => {
        const { arrangement, crdt, command, project }: typeof import('./persistedHydrationEntry') = await import(entry);
        const root = crdt.getCrdtDoc('root');
        const state = project.projectStore.value;
        const projected = arrangement.trackStore.value?.tracks;
        if (
            !root ||
            !state?.initialized ||
            state.loading ||
            !projected ||
            typeof root.tracks !== 'object' ||
            root.tracks === null ||
            !('tracks' in root.tracks) ||
            !Array.isArray(root.tracks.tracks)
        ) {
            throw new Error('Project tracks unavailable or project not ready');
        }
        const raw: unknown[] = root.tracks.tracks;
        return { raw, projected, history: command.captureUndoHistory() };
    }, ENTRY);
}

function clipCount(tracks: unknown[]): number {
    return tracks.reduce<number>((count, track) => {
        if (typeof track !== 'object' || track === null || !('clips' in track) || !Array.isArray(track.clips))
            throw new Error('Invalid track clips');
        return count + track.clips.length;
    }, 0);
}

async function addTrack(page: Page, kind: 'Audio' | 'MIDI') {
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+K`);
    const input = page.getByTestId('command-palette-input');
    await input.fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).waitFor();
    await input.press('Enter');
}

test('audio editor omits MIDI automation and preserves MIDI tray preference', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    await addTrack(page, 'Audio');
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name: 'tray-tone.wav', mimeType: 'audio/wav', buffer: buildSineWav() });
    await expect.poll(async () => clipCount((await snapshot(page)).raw)).toBe(1);
    await expect.poll(async () => clipCount((await snapshot(page)).projected)).toBe(1);
    const imported = await snapshot(page);
    expect(imported.raw).toEqual(imported.projected);
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) !== 'true') await dock.click();
    await page.getByRole('tab', { name: 'Editor' }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    await timeline.click({ position: { x: 30, y: 20 } });
    await expect(page.getByLabel('Waveform editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Knead (Pitch)' })).toBeVisible();
    await expect(page.getByTestId('toggle-automation-tray-button')).toHaveCount(0);
    await expect(page.getByTestId('clip-editor-tray')).toHaveCount(0);
    await expect(page.getByLabel('Automation lane type')).toHaveCount(0);
    const priorTracks = await snapshot(page);
    const existingIds = priorTracks.projected.map((track) => track.id);
    await addTrack(page, 'MIDI');
    await expect
        .poll(
            async () =>
                (await snapshot(page)).projected.filter(
                    (track) => track.kind === 'midi' && !existingIds.includes(track.id)
                ).length
        )
        .toBe(1);
    const tracks = await snapshot(page);
    expect(tracks.raw).toEqual(tracks.projected);
    expect(tracks.projected.filter((track) => existingIds.includes(track.id))).toEqual(priorTracks.projected);
    expect(tracks.projected.filter((track) => !existingIds.includes(track.id))).toHaveLength(1);
    const audioTrack = priorTracks.projected.find((track) => track.kind === 'audio');
    const midiTrack = tracks.projected.find((track) => track.kind === 'midi' && !existingIds.includes(track.id));
    if (!audioTrack || !midiTrack || audioTrack.clips.length !== 1 || midiTrack.clips.length !== 0) {
        throw new Error('Expected one imported audio clip and an empty MIDI track');
    }
    const audioMute = page.getByTestId(`track-mute-${audioTrack.id}`);
    const midiMute = page.getByTestId(`track-mute-${midiTrack.id}`);
    await expect(audioMute).toBeVisible();
    await expect(midiMute).toBeVisible();
    const timelineBox = await timeline.boundingBox();
    const midiBox = await midiMute.boundingBox();
    const audioBox = await audioMute.boundingBox();
    if (!timelineBox || !midiBox || !audioBox) throw new Error('Track or timeline geometry unavailable');
    const view = await page.evaluate(async (entry) => {
        const { arrangement }: typeof import('./persistedHydrationEntry') = await import(entry);
        return arrangement.timelineViewStore.value;
    }, ENTRY);
    if (!view) throw new Error('Timeline view unavailable');
    const midiY = midiBox.y + midiBox.height / 2;
    const audioY = audioBox.y + audioBox.height / 2;
    await page.getByRole('radio', { name: 'Draw (D/B)' }).click();
    const drawStartX = Math.max(1, view.pixelsPerBeat - view.scrollX);
    const drawEndX = drawStartX + view.pixelsPerBeat * 2;
    const audioX = (audioTrack.clips[0]!.startBeat + 0.5) * view.pixelsPerBeat - view.scrollX;
    if (drawEndX >= timelineBox.width || audioX <= 0 || audioX >= timelineBox.width)
        throw new Error('Clips outside visible timeline');
    await page.mouse.move(timelineBox.x + drawStartX, midiY);
    await page.mouse.down();
    await page.mouse.move(timelineBox.x + drawEndX, midiY);
    await page.mouse.up();
    await expect.poll(async () => clipCount((await snapshot(page)).raw)).toBe(2);
    await expect.poll(async () => clipCount((await snapshot(page)).projected)).toBe(2);
    const drawn = await snapshot(page);
    const midiClip = drawn.projected.find((track) => track.id === midiTrack.id)?.clips[0];
    if (!midiClip || midiClip.type !== 'midi') throw new Error('Draw did not create a MIDI clip on the intended track');
    const midiX = ((midiClip.startBeat + midiClip.endBeat) / 2) * view.pixelsPerBeat - view.scrollX;
    if (midiX <= 0 || midiX >= timelineBox.width) throw new Error('MIDI clip outside visible timeline');
    await page.getByRole('radio', { name: 'Select (S)' }).click();
    await page.mouse.click(timelineBox.x + midiX, midiY);
    const toggle = page.getByTestId('toggle-automation-tray-button');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('clip-editor-tray')).toBeVisible();
    const before = await snapshot(page);
    expect(before.raw).toEqual(before.projected);
    const observations = [];
    for (const shown of [false, true]) {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', String(shown));
        await page.mouse.click(timelineBox.x + audioX, audioY);
        await expect(page.getByLabel('Waveform editor')).toBeVisible();
        await expect(toggle).toHaveCount(0);
        await expect(page.getByTestId('clip-editor-tray')).toHaveCount(0);
        const audioSnapshot = await snapshot(page);
        expect(audioSnapshot).toEqual(before);
        const audioState = {
            waveform: await page.getByLabel('Waveform editor').isVisible(),
            toggleCount: await toggle.count(),
            trayCount: await page.getByTestId('clip-editor-tray').count(),
            selectedStart: await page.getByTestId('selected-clip-start-beat').textContent(),
        };
        await page.mouse.click(timelineBox.x + midiX, midiY);
        await expect(toggle).toHaveAttribute('aria-pressed', String(shown));
        await expect(page.getByTestId('clip-editor-tray')).toHaveCount(shown ? 1 : 0);
        const midiSnapshot = await snapshot(page);
        expect(midiSnapshot).toEqual(before);
        const midiState = {
            togglePressed: await toggle.getAttribute('aria-pressed'),
            trayCount: await page.getByTestId('clip-editor-tray').count(),
            selectedStart: await page.getByTestId('selected-clip-start-beat').textContent(),
        };
        observations.push({ shown, audioSnapshot, audioState, midiSnapshot, midiState });
    }
    await testInfo.attach('tray-state.json', {
        body: JSON.stringify({ before, observations }, null, 2),
        contentType: 'application/json',
    });
});
