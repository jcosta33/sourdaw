import { fileURLToPath } from 'node:url';
import { env } from 'node:process';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

// A small bundled WAV fixture — imported through the Browser's file input so a
// real, previewable, draggable sample row exists for the test.
const SAMPLE_FIXTURE = fileURLToPath(
    new URL('../../public/samples/levain/clarinet/DCClar_stac_F2_v1_rr1_sum.wav', import.meta.url)
);
const SAMPLE_NAME = 'DCClar_stac_F2_v1_rr1_sum';
const HYDRATION_ENTRY = isBuiltE2eShardRun(env)
    ? '/e2e/persisted-hydration.js'
    : '/tests/e2e/persistedHydrationEntry.ts';

async function sampleClips(page: Page) {
    return page.evaluate(
        async ({ name, entryPath }) => {
            const { arrangement, crdt }: typeof import('./persistedHydrationEntry') = await import(entryPath);
            const rootTracks = crdt.getCrdtDoc('root')?.tracks;
            if (typeof rootTracks !== 'object' || rootTracks === null || !('tracks' in rootTracks)) {
                throw new Error('Project track authority is unavailable');
            }
            const summarize = (value: unknown) => {
                if (!Array.isArray(value)) throw new Error('Project tracks are unavailable');
                const tracks: unknown[] = value;
                const ids: string[] = [];
                const clips = tracks.flatMap((track) => {
                    if (typeof track !== 'object' || track === null || !('id' in track) || !('clips' in track)) {
                        throw new Error('Project track is malformed');
                    }
                    if (typeof track.id !== 'string' || !Array.isArray(track.clips)) {
                        throw new Error('Project track identity or clips are malformed');
                    }
                    const trackId = track.id;
                    ids.push(trackId);
                    const clips: unknown[] = track.clips;
                    return clips.flatMap((clip) => {
                        if (typeof clip !== 'object' || clip === null || !('name' in clip)) {
                            throw new Error('Project clip is malformed');
                        }
                        if (clip.name !== name) return [];
                        if (
                            !('id' in clip) ||
                            typeof clip.id !== 'string' ||
                            !('type' in clip) ||
                            typeof clip.type !== 'string' ||
                            !('startBeat' in clip) ||
                            typeof clip.startBeat !== 'number' ||
                            !('endBeat' in clip) ||
                            typeof clip.endBeat !== 'number' ||
                            !('audioBufferId' in clip) ||
                            typeof clip.audioBufferId !== 'string' ||
                            !('assetHash' in clip) ||
                            typeof clip.assetHash !== 'string'
                        )
                            throw new Error('Sample clip source or identity is malformed');
                        return [
                            {
                                trackId,
                                id: clip.id,
                                type: clip.type,
                                startBeat: clip.startBeat,
                                endBeat: clip.endBeat,
                                audioBufferId: clip.audioBufferId,
                                assetHash: clip.assetHash,
                            },
                        ];
                    });
                });
                return { ids, clips };
            };
            return {
                projected: summarize(arrangement.trackStore.value?.tracks ?? []),
                raw: summarize(rootTracks.tracks),
            };
        },
        { name: SAMPLE_NAME, entryPath: HYDRATION_ENTRY }
    );
}

test.describe('Sample Library', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('imports, previews and drops a sample as one undoable project clip', async ({ page }) => {
        await page.getByRole('button', { name: 'Audio Record or import' }).click();
        await expect(page.getByLabel('Timeline editor surface')).toBeVisible();
        // Open the Browser panel if it is not already showing.
        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
        if (!(await browserPanel.isVisible())) {
            await page.getByRole('button', { name: /Toggle browser/i }).click();
            await expect(browserPanel).toBeVisible();
        }

        // Navigate to the Library tab, then the "Imported" samples sub-tab (the
        // Samples surface — it renders the SamplesTab list).
        await browserPanel.getByRole('tab', { name: 'Library', exact: true }).click();
        const importedSubTab = browserPanel.getByRole('tab', { name: 'Imported', exact: true });
        await expect(importedSubTab).toBeVisible();
        await importedSubTab.click();

        // Import a real WAV through the hidden file input so a sample row exists.
        const fileInput = browserPanel.locator('input[type="file"]');
        await fileInput.setInputFiles(SAMPLE_FIXTURE);

        // The decoded sample appears as a draggable row.
        const sampleRow = browserPanel.getByText(SAMPLE_NAME, { exact: true });
        await expect(sampleRow).toBeVisible();

        // Preview the sample — the preview control flips to its "Stop" state.
        const previewButton = browserPanel.getByRole('button', { name: `Preview ${SAMPLE_NAME}` }).first();
        await expect(previewButton).toBeVisible();
        await previewButton.click();
        await expect(browserPanel.getByRole('button', { name: `Stop previewing ${SAMPLE_NAME}` })).toBeVisible();

        // Initiate a drag of the sample toward the timeline. HTML5 drag-and-drop
        // is driven through real dragstart/dragover events sharing one
        // DataTransfer; the timeline surface reacts to dragover by revealing its
        // drop overlay, which is the observable proof the drag reached it.
        const dragSource = sampleRow.locator('xpath=ancestor-or-self::*[@draggable="true"][1]');
        const timeline = page.getByLabel('Timeline editor surface');
        await expect(timeline).toBeVisible();

        const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
        await dragSource.dispatchEvent('dragstart', { dataTransfer });
        await timeline.dispatchEvent('dragenter', { dataTransfer });
        await timeline.dispatchEvent('dragover', { dataTransfer });

        // The timeline shows its "Drop ... here" overlay while a drag hovers it.
        await expect(page.getByText('Drop audio or MIDI files here')).toBeVisible();

        const before = await sampleClips(page);
        expect(before.projected.clips).toEqual([]);
        expect(before.raw).toEqual(before.projected);
        expect(before.projected.ids.length).toBeGreaterThan(1);
        const box = await timeline.boundingBox();
        if (!box) throw new Error('Timeline has no drop coordinates');
        await timeline.dispatchEvent('drop', { dataTransfer, clientX: box.x + 20, clientY: box.y + 20 });

        await expect.poll(async () => (await sampleClips(page)).projected.clips.length).toBe(1);
        const placed = await sampleClips(page);
        expect(placed.raw).toEqual(placed.projected);
        expect(placed.projected.ids).toEqual(before.projected.ids);
        expect(before.projected.ids).toContain(placed.projected.clips[0]!.trackId);
        expect(placed.projected.clips[0]).toMatchObject({ type: 'audio', audioBufferId: expect.any(String) });
        expect(placed.projected.clips[0]!.assetHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(placed.projected.clips[0]!.endBeat).toBeGreaterThan(placed.projected.clips[0]!.startBeat);
        const sourceMatches = await page.evaluate(
            async ({ bufferId, entryPath }) => {
                const { audio }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                const actual = audio.getCachedAudioBuffer({ bufferId });
                if (!actual) throw new Error('Placed clip audio is unavailable');
                const response = await fetch('/samples/levain/clarinet/DCClar_stac_F2_v1_rr1_sum.wav');
                if (!response.ok) throw new Error('Sample fixture could not be read');
                const expected = await audio.getAudioContext().decodeAudioData(await response.arrayBuffer());
                if (
                    actual.sampleRate !== expected.sampleRate ||
                    actual.length !== expected.length ||
                    actual.numberOfChannels !== expected.numberOfChannels
                )
                    return false;
                for (let channel = 0; channel < actual.numberOfChannels; channel += 1) {
                    const got = actual.getChannelData(channel);
                    const wanted = expected.getChannelData(channel);
                    if (!got.every((sample, index) => sample === wanted[index])) return false;
                }
                return true;
            },
            { bufferId: placed.projected.clips[0]!.audioBufferId, entryPath: HYDRATION_ENTRY }
        );
        expect(sourceMatches).toBe(true);

        await page.getByTestId('transport-undo').click();
        await expect.poll(() => sampleClips(page)).toEqual(before);
        await page.getByTestId('transport-redo').click();
        await expect.poll(() => sampleClips(page)).toEqual(placed);
    });
});
