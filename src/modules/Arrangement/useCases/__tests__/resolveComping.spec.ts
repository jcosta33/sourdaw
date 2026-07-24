import { describe, it, expect, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { resolveClipsWithComping } from '../resolveComping';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn(),
    },
}));

function testClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        trackId: 't1',
        name: 'c',
        startBeat: 0,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('resolveClipsWithComping', () => {
    it('adds region bounds equal to clip bounds when lane store is empty', () => {
        mocks.takeLaneStoreValue.value = null;

        const clip = testClip({ id: 'a' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(0);
        expect(out[0]!.regionEndBeat).toBe(8);
        expect(out[0]!.sourceStartBeat).toBe(0);
        expect(out[0]!.id).toBe('a');
    });

    it('adds region bounds equal to clip bounds when track has no lane', () => {
        mocks.takeLaneStoreValue.value = { lanes: [] };

        const clip = testClip({ id: 'b' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(clip.startBeat);
        expect(out[0]!.regionEndBeat).toBe(clip.endBeat);
        expect(out[0]!.sourceStartBeat).toBe(clip.startBeat);
    });

    it('retains the source start when comping segments a loop', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'loop',
                            name: 'Take 1',
                            startBeat: 0,
                            endBeat: 8,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 4, endBeat: 6, takeId: 'take-1' }],
                },
            ],
        };

        const out = resolveClipsWithComping('t1', [
            testClip({ id: 'loop', startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 2 }),
        ]);

        expect(out.map((clip) => [clip.startBeat, clip.endBeat, clip.sourceStartBeat])).toEqual([
            [0, 4, 0],
            [4, 6, 0],
            [6, 8, 0],
        ]);
    });

    it('skips regions whose take is missing and regions whose source clip is absent', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [
                        // take-resolved exists for 'src'; the 'orphan-take' id has no take.
                        { id: 'take-src', clipId: 'src', name: 'Src', startBeat: 0, endBeat: 8, selected: true },
                    ],
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 4, takeId: 'orphan-take' }, // no matching take -> skipped
                        { startBeat: 0, endBeat: 4, takeId: 'take-src' }, // source clip 'src' not passed -> skipped
                    ],
                },
            ],
        };

        // Pass a clip that none of the regions reference.
        const out = resolveClipsWithComping('t1', [testClip({ id: 'other', startBeat: 0, endBeat: 8 })]);

        // No region resolves; the passed clip falls through as a whole gap.
        expect(out.map((c) => c.id)).toEqual(['other']);
    });

    it('skips regions that do not overlap their source clip', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [{ id: 'take-src', clipId: 'src', name: 'Src', startBeat: 0, endBeat: 8, selected: true }],
                    activeCompRegions: [
                        // Region lies entirely outside the source clip [0,8): no overlap.
                        { startBeat: 20, endBeat: 24, takeId: 'take-src' },
                    ],
                },
            ],
        };

        const out = resolveClipsWithComping('t1', [testClip({ id: 'src', startBeat: 0, endBeat: 8 })]);

        // The non-overlapping region is skipped; the clip falls through as a gap.
        expect(out.map((c) => [c.id, c.startBeat, c.endBeat])).toEqual([['src', 0, 8]]);
    });

    it('ignores comp regions that fall entirely outside a clip when computing gaps', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [{ id: 'take-src', clipId: 'src', name: 'Src', startBeat: 0, endBeat: 8, selected: true }],
                    activeCompRegions: [
                        // Region covers [2,4) inside the clip — resolves to a segment.
                        { startBeat: 2, endBeat: 4, takeId: 'take-src' },
                        // Disjoint region far outside the clip [0,8) — must be ignored.
                        { startBeat: 100, endBeat: 200, takeId: 'take-src' },
                    ],
                },
            ],
        };

        const out = resolveClipsWithComping('t1', [testClip({ id: 'src', startBeat: 0, endBeat: 8 })]);

        // Resolved segment [2,4) plus gap segments [0,2) and [4,8); the disjoint
        // region contributes nothing.
        const spans = out.map((c): [number, number] => [c.startBeat, c.endBeat]);
        spans.sort((a, b) => a[0] - b[0]);
        expect(spans).toEqual([
            [0, 2],
            [2, 4],
            [4, 8],
        ]);
    });
});
