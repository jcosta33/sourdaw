import { describe, it, expect, vi } from 'vitest';

import { type Clip } from '#/modules/Arrangement/stores';

import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as { lanes: unknown[] } | null },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

function testClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        trackId: 't1',
        name: 'c',
        startBeat: 0,
        endBeat: 8,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('resolveTrackClipsWithComping', () => {
    it('returns clip bounds as region and source bounds when the lane store is empty', () => {
        mocks.takeLaneStoreValue.value = null;

        const clip = testClip({ id: 'a' });
        const out = resolveTrackClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(0);
        expect(out[0]!.regionEndBeat).toBe(8);
        expect(out[0]!.sourceStartBeat).toBe(0);
        expect(out[0]!.id).toBe('a');
    });

    it('resolves each loop-recorded take to its own pass, and enters the uncovered tail at the tail’s own beat', () => {
        // Two complete loop passes recorded into ONE continuous clip: every
        // wrap take references the same clipId and the same loop bounds, and
        // only `sourceOffsetBeats` distinguishes which pass's PCM it addresses.
        // Sentinel PCM: pass 1 fills buffer beats [0,4) with A, pass 2 fills
        // [4,8) with B — choosing take-3 must resolve the segment that reads
        // B (four beats into the source), not A. The native live programme and
        // the offline export schedule exactly this resolver's output.
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        { id: 'take-1', clipId: 'rec', name: 'Take 1', startBeat: 0, endBeat: 8, selected: false },
                        {
                            id: 'take-2',
                            clipId: 'rec',
                            name: 'Take 2',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                            sourceOffsetBeats: 0,
                        },
                        {
                            id: 'take-3',
                            clipId: 'rec',
                            name: 'Take 3',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-3' }],
                },
            ],
        };

        const recording = testClip({ id: 'rec', startBeat: 0, endBeat: 8, audioBufferId: 'rec-buf' });
        const out = resolveTrackClipsWithComping('t1', [recording]);

        // The chosen segment plus the uncovered tail, which still reads the
        // clip origin (pass 1's sentinel A) — but four beats into it, because
        // the tail itself starts four beats after the clip does. Before the
        // displacement fold the tail carried no offset at all and therefore
        // replayed the sentinel from beat 0 while sitting at beat 4.
        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.sourceStartBeat, clip.audioOffsetBeats])).toEqual([
            [0, 4, -4, 4],
            [4, 8, 0, 4],
        ]);
        // Same continuous recording — take selection never mints new media.
        expect(out[0]!.id).toBe('rec');
        expect(out[0]!.audioBufferId).toBe('rec-buf');
    });

    it('folds each fragment’s displacement from the media origin into the audio clip’s own offset', () => {
        // One flat take over a slipped clip, one region in the middle. Every
        // consumer enters the media at the fragment's own start beat using the
        // offset field alone, so each of the three fragments must carry its own
        // distance from the media origin — the region included. The region used
        // to pass the clip's slip offset straight through and therefore played
        // the clip's first two beats again, two beats late.
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        // No `sourceOffsetBeats`: flat recordings, manual takes,
                        // and projects predating the field all resolve here.
                        { id: 'take-1', clipId: 'src', name: 'Take 1', startBeat: 0, endBeat: 8, selected: false },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: 'take-1' }],
                },
            ],
        };

        const source = testClip({ id: 'src', startBeat: 0, endBeat: 8, audioBufferId: 'buf', audioOffsetBeats: 0.5 });
        const out = resolveTrackClipsWithComping('t1', [source]);

        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.sourceStartBeat, clip.audioOffsetBeats])).toEqual([
            [0, 2, 0, 0.5],
            [2, 4, 0, 2.5],
            [4, 8, 0, 4.5],
        ]);
        // The fragment sitting on the media origin is still exactly the
        // pre-field shape: nothing is added when there is nothing to displace.
        expect(out[0]).toStrictEqual({
            ...source,
            startBeat: 0,
            endBeat: 2,
            regionStartBeat: 0,
            regionEndBeat: 2,
            sourceStartBeat: 0,
        });
    });

    it('measures a region inside a loop pass from that pass’s own depth in the recording', () => {
        // The media origin sits behind the clip's start by the pass depth, so a
        // region one beat into the clip reads five beats into the buffer.
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        {
                            id: 'take-3',
                            clipId: 'rec',
                            name: 'Take 3',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 1, endBeat: 3, takeId: 'take-3' }],
                },
            ],
        };

        const out = resolveTrackClipsWithComping('t1', [
            testClip({ id: 'rec', startBeat: 0, endBeat: 8, audioBufferId: 'rec-buf' }),
        ]);

        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.sourceStartBeat, clip.audioOffsetBeats])).toEqual([
            [0, 1, 0, undefined],
            [1, 3, -4, 5],
            [3, 8, 0, 3],
        ]);
    });

    it('folds a MIDI fragment’s displacement into midiOffsetBeats and mints no audio offset', () => {
        // The native and offline MIDI projections read `midiOffsetBeats`
        // relative to the fragment's own start, and an audio offset on a MIDI
        // clip would be a field no consumer reads.
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [{ id: 'take-1', clipId: 'src', name: 'Take 1', startBeat: 0, endBeat: 8, selected: true }],
                    activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: 'take-1' }],
                },
            ],
        };

        const out = resolveTrackClipsWithComping('t1', [
            testClip({ id: 'src', type: 'midi', startBeat: 0, endBeat: 8, midiOffsetBeats: 1 }),
        ]);

        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.midiOffsetBeats])).toEqual([
            [0, 2, 1],
            [2, 4, 3],
            [4, 8, 5],
        ]);
        expect(out.every((clip) => !Object.hasOwn(clip, 'audioOffsetBeats'))).toBe(true);
    });
});
