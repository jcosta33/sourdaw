import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cancelScheduledToasterHits } from '../cancelScheduledToasterHits';
import { getSequencerPlaybackState } from '../getSequencerPlaybackState';
import { setFillActive } from '../setFillActive';

vi.mock('../cancelScheduledToasterHits', () => ({
    cancelScheduledToasterHits: vi.fn(),
}));

describe('setFillActive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('turns fill on for the given device without touching other devices', () => {
        setFillActive('dev-x', true);

        expect(getSequencerPlaybackState('dev-x').fillActive).toBe(true);
        expect(getSequencerPlaybackState('dev-y').fillActive).toBe(false);
    });

    it('turns fill back off for the given device', () => {
        setFillActive('dev-z', true);
        setFillActive('dev-z', false);

        expect(getSequencerPlaybackState('dev-z').fillActive).toBe(false);
    });

    it('invalidates the queued lookahead so conditions are evaluated with the new fill state', () => {
        const state = getSequencerPlaybackState('dev-queued');
        state.preScheduledStep = 3;

        setFillActive('dev-queued', true);

        expect(state.preScheduledStep).toBeNull();
        expect(cancelScheduledToasterHits).toHaveBeenCalledWith('dev-queued');
    });
});
