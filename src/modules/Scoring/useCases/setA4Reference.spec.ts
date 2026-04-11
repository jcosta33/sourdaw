import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/scoringStore', () => ({
    scoringStore: { value: {}, set: vi.fn() },
    getScoringState: vi.fn(() => ({ a4Reference: 440, mode: 'note' })),
}));

import { setA4Reference } from './setA4Reference';
import { scoringStore, getScoringState } from '../stores/scoringStore';

describe('setA4Reference', () => {
    beforeEach(() => {
        vi.mocked(scoringStore.set).mockClear();
        vi.mocked(getScoringState).mockClear();
    });

    it('writes the new A4 reference for the given device', () => {
        setA4Reference('d1', 442);

        expect(scoringStore.set).toHaveBeenCalledWith({
            d1: { a4Reference: 442, mode: 'note' },
        });
    });
});
