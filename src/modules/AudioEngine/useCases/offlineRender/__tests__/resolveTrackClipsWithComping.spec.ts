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

    it('resolves each loop-recorded take to its own pass inside the shared recording clip', () => {
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
        // clip origin (pass 1's sentinel A).
        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.sourceStartBeat, clip.audioOffsetBeats])).toEqual([
            [0, 4, -4, 4],
            [4, 8, 0, undefined],
        ]);
        // Same continuous recording — take selection never mints new media.
        expect(out[0]!.id).toBe('rec');
        expect(out[0]!.audioBufferId).toBe('rec-buf');
    });

    it('resolves takes without a source offset byte-identically to the pre-field shape', () => {
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

        // The region segment is exactly the pre-field shape: the clip's own
        // slip offset passes through untouched and the source stays at the
        // clip origin. (The uncovered gaps [0,2) and [4,8) fall through
        // alongside it, sorted by start beat.)
        expect(out).toHaveLength(3);
        const regionSegment = out.find((clip) => clip.regionStartBeat === 2);
        expect(regionSegment).toEqual({
            ...source,
            startBeat: 2,
            endBeat: 4,
            regionStartBeat: 2,
            regionEndBeat: 4,
            sourceStartBeat: 0,
        });
    });
});
