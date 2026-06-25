import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/scoringStore', () => ({
    scoringStore: { value: {}, set: vi.fn() },
    getScoringState: vi.fn(() => ({ a4Reference: 440, mode: 'needle' })),
}));

import { scoringStore, getScoringState } from '../../stores/scoringStore';
import { setDisplayMode } from '../setDisplayMode';

describe('setDisplayMode', () => {
    beforeEach(() => {
        vi.mocked(scoringStore.set).mockClear();
        vi.mocked(getScoringState).mockClear();
    });

    it('writes the new display mode for the given device', () => {
        // 'strobe' is a real DisplayMode member; the prior fixture used non-DisplayMode
        // strings ('note'/'cents') that the use-case signature would never accept.
        setDisplayMode('d1', 'strobe');

        expect(scoringStore.set).toHaveBeenCalledWith({
            d1: { a4Reference: 440, mode: 'strobe' },
        });
    });
});
