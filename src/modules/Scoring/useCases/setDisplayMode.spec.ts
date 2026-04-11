import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/scoringStore', () => ({
    scoringStore: { value: {}, set: vi.fn() },
    getScoringState: vi.fn(() => ({ a4Reference: 440, mode: 'note' })),
}));

import { setDisplayMode } from './setDisplayMode';
import { scoringStore, getScoringState } from '../stores/scoringStore';

describe('setDisplayMode', () => {
    beforeEach(() => {
        vi.mocked(scoringStore.set).mockClear();
        vi.mocked(getScoringState).mockClear();
    });

    it('writes the new display mode for the given device', () => {
        setDisplayMode('d1', 'cents');

        expect(scoringStore.set).toHaveBeenCalledWith({
            d1: { a4Reference: 440, mode: 'cents' },
        });
    });
});
