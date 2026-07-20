import { describe, it, expect, beforeEach } from 'vitest';

import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { getTimeSignatureAtBeat } from '../getTimeSignatureAtBeat';

describe('getTimeSignatureAtBeat', () => {
    beforeEach(() => {
        timeSignatureMapStore.set({ changes: [] });
    });

    it('should default to 4/4 when the store has no changes', () => {
        expect(getTimeSignatureAtBeat(0)).toEqual({ numerator: 4, denominator: 4 });
        expect(getTimeSignatureAtBeat(64)).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should default to 4/4 when queried before the first change', () => {
        timeSignatureMapStore.set({
            changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }],
        });

        expect(getTimeSignatureAtBeat(4)).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should return the most recent change at or before the given beat', () => {
        timeSignatureMapStore.set({
            changes: [
                { id: 'ts-1', beat: 0, numerator: 4, denominator: 4 },
                { id: 'ts-2', beat: 8, numerator: 3, denominator: 4 },
                { id: 'ts-3', beat: 16, numerator: 7, denominator: 8 },
            ],
        });

        expect(getTimeSignatureAtBeat(8)).toEqual({ numerator: 3, denominator: 4 });
        expect(getTimeSignatureAtBeat(12)).toEqual({ numerator: 3, denominator: 4 });
        expect(getTimeSignatureAtBeat(20)).toEqual({ numerator: 7, denominator: 8 });
    });

    it('should default to 4/4 when the store has not been initialized', () => {
        timeSignatureMapStore.set(null);

        expect(getTimeSignatureAtBeat(0)).toEqual({ numerator: 4, denominator: 4 });
    });
});
