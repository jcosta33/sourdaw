import { describe, expect, it } from 'vitest';

import { resolveOutputTarget } from '../resolveOutputTarget';

const busStripIds = new Set(['bus-1']);
const trackStripIds = new Set(['master', 'track-a']);

describe('resolveOutputTarget', () => {
    it('resolves a bus whose output names the master track to the master target', () => {
        expect(
            resolveOutputTarget({
                outputId: 'master',
                sourceKind: 'bus',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'master' });
    });

    it('resolves an ordinary track routed at the master track to a track target', () => {
        expect(
            resolveOutputTarget({
                outputId: 'master',
                sourceKind: 'track',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'track', trackId: 'master' });
    });

    it('resolves a bus routed at an ordinary track to a track target', () => {
        expect(
            resolveOutputTarget({
                outputId: 'track-a',
                sourceKind: 'bus',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'track', trackId: 'track-a' });
    });

    it('prefers a bus destination over a track with the same id', () => {
        expect(
            resolveOutputTarget({
                outputId: 'shared',
                sourceKind: 'track',
                busStripIds: new Set(['shared']),
                trackStripIds: new Set(['shared']),
            })
        ).toEqual({ kind: 'bus', busId: 'shared' });
    });

    it.each(['hw_out', null, undefined, 'missing'] as const)('falls back to master for output id %s', (outputId) => {
        expect(
            resolveOutputTarget({
                outputId,
                sourceKind: 'track',
                busStripIds,
                trackStripIds,
            })
        ).toEqual({ kind: 'master' });
    });
});
