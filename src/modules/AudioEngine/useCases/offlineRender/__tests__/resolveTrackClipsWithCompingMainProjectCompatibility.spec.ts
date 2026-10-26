import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

describe('invalid modern take source ownership', () => {
    it('omits an invalid placed owner and continues resolving a valid take', () => {
        const clip = { ...recording(0, 4), audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: 0 };
        const state: TakeLaneStoreState = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        {
                            id: 'invalid',
                            clipId: 'rec',
                            name: 'Invalid',
                            startBeat: 0,
                            endBeat: 2,
                            selected: false,
                            sourceOffsetBeats: 0,
                            passAnchorSeconds: 0,
                            passDepthSeconds: 0,
                            passOriginBeat: 0,
                        },
                        {
                            id: 'valid',
                            clipId: 'rec',
                            name: 'Valid',
                            startBeat: 2,
                            endBeat: 4,
                            selected: false,
                            sourceOffsetSeconds: 1,
                        },
                    ],
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 2, takeId: 'invalid' },
                        { startBeat: 2, endBeat: 4, takeId: 'valid' },
                    ],
                },
            ],
        };
        const resolved = resolveTrackClipsWithComping('t1', [clip], state, {
            tempoAtBeat: () => 120,
            secondsAtBeat: (beat) => beat / 2,
            beatAtSeconds: (seconds) => seconds * 2,
        });
        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({ startBeat: 2, endBeat: 4, audioOffsetSeconds: 2 });
    });
});

function recording(startBeat: number, endBeat: number, audioOffsetBeats?: number): Clip {
    const clip: Clip = {
        id: 'rec',
        trackId: 't1',
        name: 'Recording',
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId: 'rec-buf',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
    if (audioOffsetBeats !== undefined) {
        clip.audioOffsetBeats = audioOffsetBeats;
    }
    return clip;
}

/** A loop recording's lanes exactly as main saves them: wrap takes carry only their offset. */
const savedByMain: TakeLaneStoreState = {
    lanes: [
        {
            id: 'lane-1',
            trackId: 't1',
            takes: [
                { id: 'take-1', clipId: 'rec', name: 'Take 1', startBeat: 1, endBeat: 9, selected: false },
                {
                    id: 'pass-1',
                    clipId: 'rec',
                    name: 'Take 2',
                    startBeat: 2,
                    endBeat: 6,
                    selected: false,
                    sourceOffsetBeats: 1,
                },
                {
                    id: 'pass-2',
                    clipId: 'rec',
                    name: 'Take 3',
                    startBeat: 2,
                    endBeat: 6,
                    selected: false,
                    sourceOffsetBeats: 5,
                },
            ],
            activeCompRegions: [
                { startBeat: 2, endBeat: 3, takeId: 'pass-1' },
                { startBeat: 3, endBeat: 6, takeId: 'pass-2' },
            ],
        },
    ],
};

describe('resolveTrackClipsWithComping on a project saved before pass placement existed', () => {
    // Every fragment main's offline resolver produces for these clips, worked by
    // hand from its law: a comped fragment enters the media at the clip's own
    // offset plus its distance from `clip.startBeat - sourceOffsetBeats`, a gap
    // at the clip's own offset plus its distance from the clip start.
    it.each([
        {
            name: 'as recorded',
            clip: recording(1, 10),
            asMain: [
                { startBeat: 1, endBeat: 2, audioOffsetBeats: 0, sourceStartBeat: 1 },
                { startBeat: 2, endBeat: 3, audioOffsetBeats: 2, sourceStartBeat: 0 },
                { startBeat: 3, endBeat: 6, audioOffsetBeats: 7, sourceStartBeat: -4 },
                { startBeat: 6, endBeat: 10, audioOffsetBeats: 5, sourceStartBeat: 1 },
            ],
        },
        {
            // A negative offset starts the content two beats after the clip,
            // so its media origin sits inside the clip: main still sounded each
            // comped pass from the clip start, its head as leading silence.
            name: 'content slipped later',
            clip: recording(2, 10, -2),
            asMain: [
                { startBeat: 2, endBeat: 3, audioOffsetBeats: -1, sourceStartBeat: 1 },
                { startBeat: 3, endBeat: 6, audioOffsetBeats: 4, sourceStartBeat: -3 },
                { startBeat: 6, endBeat: 10, audioOffsetBeats: 2, sourceStartBeat: 2 },
            ],
        },
    ])('resolves every fragment main resolved when the clip is $name', ({ clip, asMain }) => {
        const resolved = resolveTrackClipsWithComping('t1', [clip], savedByMain).map(
            ({ startBeat, endBeat, audioOffsetBeats, sourceStartBeat }) => ({
                startBeat,
                endBeat,
                audioOffsetBeats: audioOffsetBeats ?? 0,
                sourceStartBeat,
            })
        );

        expect(resolved).toEqual(asMain);
    });
});

describe('resolveTrackClipsWithComping off the beat grid at a constant tempo', () => {
    afterEach(() => {
        transportStore.set({ ...transportStore.value!, tempo: 120 });
    });

    it('returns main’s offsets to the last bit, and the clip itself where nothing is displaced', () => {
        transportStore.set({ ...transportStore.value!, tempo: 140 });
        const clip = recording(3.3, 10, 0.1);
        const mainTake = (id: string, sourceOffsetBeats: number) => ({
            id,
            clipId: 'rec',
            name: id,
            startBeat: 3.3,
            endBeat: 10,
            selected: false,
            sourceOffsetBeats,
        });
        const state: TakeLaneStoreState = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [mainTake('from-start', 0), mainTake('deeper', 0.25)],
                    activeCompRegions: [
                        { startBeat: 3.3, endBeat: 4, takeId: 'from-start' },
                        { startBeat: 4, endBeat: 5, takeId: 'deeper' },
                    ],
                },
            ],
        };

        const [fromStart, deeper, gap] = resolveTrackClipsWithComping('t1', [clip], state);

        expect(fromStart?.audioOffsetBeats).toBe(0.1);
        expect({ ...fromStart, endBeat: clip.endBeat }).toStrictEqual({
            ...clip,
            regionStartBeat: 3.3,
            regionEndBeat: 4,
            sourceStartBeat: 3.3,
        });
        expect(deeper?.audioOffsetBeats).toBe(0.1 + (4 - (3.3 - 0.25)));
        expect(gap?.audioOffsetBeats).toBe(0.1 + (5 - 3.3));
    });
});
