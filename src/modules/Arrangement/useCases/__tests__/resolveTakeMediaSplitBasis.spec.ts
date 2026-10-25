import { afterEach, describe, expect, it } from 'vitest';

import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { type Take } from '../../models/TakeLane';
import { createTrack, type Clip } from '../../models/Track';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';
import { splitClip } from '../clipEditing/splitClip';
import { resolveTakeMedia } from '../resolveTakeMedia';

const timeline = {
    secondsAtBeat: (beat: number) => beat / 2,
    beatAtSeconds: (seconds: number) => seconds * 2,
    tempoAtBeat: () => 120,
};

function splitWithUnselectedTakes() {
    tempoMapStore.set({ changes: [] });
    transportStore.set({ ...defaultTransportState, tempo: 120 });
    const clip: Clip = {
        id: 'source',
        trackId: 'audio',
        name: 'Source',
        type: 'audio',
        startBeat: 17,
        endBeat: 29,
        audioOffsetBeats: 17,
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 0,
        stretchMode: 'timestretch',
        stretchRatio: 2,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
    const track = { ...createTrack({ id: 'audio', name: 'Audio', kind: 'audio' }), clips: [clip] };
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    const base: Take = { id: 'base', clipId: clip.id, name: 'Base', startBeat: 17, endBeat: 29, selected: true };
    const unplaced: Take = { ...base, id: 'unplaced', name: 'Unplaced', selected: false, sourceOffsetBeats: 4 };
    const placed: Take = {
        ...base,
        id: 'placed',
        name: 'Placed',
        selected: false,
        sourceOffsetBeats: 4,
        passAnchorSeconds: 10.5,
        passDepthSeconds: 2,
        passSourceEndSeconds: 6,
    };
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane',
                trackId: track.id,
                takes: [base, unplaced, placed],
                activeCompRegions: [{ startBeat: 17, endBeat: 29, takeId: base.id }],
            },
        ],
    });
    expect(splitClip(clip.id, 18, 'right')).toBe('right');
    const right = trackStore.value!.tracks[0]!.clips.find((candidate) => candidate.id === 'right');
    const rightUnplaced = takeLaneStore.value!.lanes[0]!.takes.find(
        (take) => take.clipId === 'right' && take.name === unplaced.name
    );
    const rightPlaced = takeLaneStore.value!.lanes[0]!.takes.find(
        (take) => take.clipId === 'right' && take.name === placed.name
    );
    if (!right || !rightUnplaced || !rightPlaced)
        throw new Error('Expected the real split to retain both unselected takes');
    expect(rightUnplaced.selected).toBe(false);
    expect(rightPlaced.selected).toBe(false);
    return { clip, unplaced, placed, right, rightUnplaced, rightPlaced };
}

describe('placed and unplaced take origins through a stretched split', () => {
    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
    });

    it('keeps the future unplaced entry at 11 seconds on the right clip head', () => {
        const { clip, unplaced, right, rightUnplaced } = splitWithUnselectedTakes();
        const before = resolveTakeMedia(unplaced, clip, timeline);
        const after = resolveTakeMedia(rightUnplaced, right, timeline);
        expect(before.offsetAt(18) / 2).toBe(11);
        expect(after.offsetAt(18) / 2).toBe(11);
    });

    it.each([
        { rate: 2, firstBeat: 19, lastBeat: 23 },
        { rate: 1, firstBeat: 21, lastBeat: 29 },
    ])(
        'retains placed eligibility at beat $firstBeat when the source rate becomes $rate',
        ({ rate, firstBeat, lastBeat }) => {
            const { clip, placed, right, rightPlaced } = splitWithUnselectedTakes();
            const before = resolveTakeMedia(placed, { ...clip, stretchRatio: rate }, timeline);
            const after = resolveTakeMedia(rightPlaced, { ...right, stretchRatio: rate }, timeline);
            expect(before.earliestBeat).toBe(firstBeat);
            expect(after.earliestBeat).toBe(firstBeat);
            expect(after.latestBeatAt?.(firstBeat)).toBe(lastBeat);
            expect(after.offsetAt(firstBeat) / 2).toBe(2);
            expect(rightPlaced).toMatchObject({
                passAnchorSeconds: 10.5,
                passDepthSeconds: 2,
                passSourceEndSeconds: 6,
                passOriginBeat: 17,
                passOriginSourceSeconds: 8.5,
            });
        }
    );
});
