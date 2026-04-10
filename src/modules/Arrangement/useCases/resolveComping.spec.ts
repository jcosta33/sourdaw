import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { resolveClipsWithComping } from './resolveComping';

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
    beforeEach(() => {
        Container.clear();
    });

    it('adds region bounds equal to clip bounds when lane store is empty', () => {
        injectDependencies(resolveClipsWithComping, {
            takeLaneStore: {
                value: null,
                set: () => {},
            } as never,
        });
        const clip = testClip({ id: 'a' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(0);
        expect(out[0]!.regionEndBeat).toBe(8);
        expect(out[0]!.id).toBe('a');
    });

    it('adds region bounds equal to clip bounds when track has no lane', () => {
        injectDependencies(resolveClipsWithComping, {
            takeLaneStore: {
                value: { lanes: [] },
                set: () => {},
            } as never,
        });
        const clip = testClip({ id: 'b' });
        const out = resolveClipsWithComping('t1', [clip]);
        expect(out).toHaveLength(1);
        expect(out[0]!.regionStartBeat).toBe(clip.startBeat);
        expect(out[0]!.regionEndBeat).toBe(clip.endBeat);
    });
});
