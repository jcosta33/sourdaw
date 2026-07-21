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
});
