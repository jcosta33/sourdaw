import { describe, expect, it } from 'vitest';

import { resolveOutputTarget } from '../resolveOutputTarget';

const busStripIds = new Set(['bus-1']);
const trackStripIds = new Set(['master', 'track-a']);

describe('resolveOutputTarget', () => {
    it('resolves a master-track output id to a track target', () => {
        expect(
            resolveOutputTarget({
                outputId: 'master',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'track', trackId: 'master' });
    });

    it('resolves a bus routed at an ordinary track to a track target', () => {
        expect(
            resolveOutputTarget({
                outputId: 'track-a',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'track', trackId: 'track-a' });
    });

    it('prefers a bus destination over a track with the same id', () => {
        expect(
            resolveOutputTarget({
                outputId: 'shared',
                busStripIds: new Set(['shared']),
                trackStripIds: new Set(['shared']),
            })
        ).toEqual({ kind: 'bus', busId: 'shared' });
    });

    it.each(['hw_out', null, undefined, 'missing'] as const)('falls back to master for output id %s', (outputId) => {
        expect(
            resolveOutputTarget({
                outputId,
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'master' });
    });
});
