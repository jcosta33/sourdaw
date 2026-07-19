import { describe, it, expect } from 'vitest';

import { getSequencerPlaybackState } from '../getSequencerPlaybackState';

describe('getSequencerPlaybackState', () => {
    it('creates an idle default state the first time a deviceId is seen', () => {
        const state = getSequencerPlaybackState('dev-fresh');

        expect(state).toEqual({
            running: false,
            fillActive: false,
            playCount: 0,
            nextTickTime: 0,
            timeoutId: null,
            preScheduledStep: null,
            lastBpm: null,
            pendingFireIds: new Set(),
        });
    });

    it('returns the same live object on every call for the same deviceId', () => {
        const first = getSequencerPlaybackState('dev-same');
        first.playCount = 7;
        first.fillActive = true;

        const second = getSequencerPlaybackState('dev-same');

        expect(second).toBe(first);
        expect(second.playCount).toBe(7);
        expect(second.fillActive).toBe(true);
    });

    it('keeps state fully independent across different deviceIds', () => {
        const a = getSequencerPlaybackState('dev-a');
        const b = getSequencerPlaybackState('dev-b');
        a.playCount = 3;
        a.fillActive = true;

        expect(a).not.toBe(b);
        expect(b.playCount).toBe(0);
        expect(b.fillActive).toBe(false);
    });
});
