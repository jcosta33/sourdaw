import { describe, it, expect, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { resolveClipsWithComping } from '../resolveComping';

vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
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
        takeLaneStore.value = null;

        const clip = testClip({ id: 'a' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(0);
        expect(out[0]!.regionEndBeat).toBe(8);
        expect(out[0]!.id).toBe('a');
    });

    it('adds region bounds equal to clip bounds when track has no lane', () => {
        takeLaneStore.value = { lanes: [] } as TakeLaneStoreState;

        const clip = testClip({ id: 'b' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(clip.startBeat);
        expect(out[0]!.regionEndBeat).toBe(clip.endBeat);
    });
});
