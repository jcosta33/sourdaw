import { describe, it, expect } from 'vitest';

import { getSequencerPlaybackState } from '../getSequencerPlaybackState';
import { setFillActive } from '../setFillActive';

describe('setFillActive', () => {
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
});
