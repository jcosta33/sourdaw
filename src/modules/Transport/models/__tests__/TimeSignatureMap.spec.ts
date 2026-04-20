import { describe, it, expect } from 'vitest';

import {
    createTimeSignatureChange,
    getBarBeatAtPosition,
    getTimeSignatureAtBeat,
    type TimeSignatureChange,
} from '../TimeSignatureMap';

describe('createTimeSignatureChange', () => {
    it('should clamp numerator and denominator', () => {
        expect(createTimeSignatureChange(0, 0, 0)).toMatchObject({ numerator: 1, denominator: 1 });
        expect(createTimeSignatureChange(0, 99, 99)).toMatchObject({ numerator: 32, denominator: 32 });
    });
});

describe('getTimeSignatureAtBeat', () => {
    it('should return defaults when there are no changes', () => {
        expect(getTimeSignatureAtBeat([], 0, 4, 4)).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should return defaults when beat is before the first change', () => {
        const changes: TimeSignatureChange[] = [{ id: 'a', beat: 4, numerator: 3, denominator: 4 }];
        expect(getTimeSignatureAtBeat(changes, 2, 4, 4)).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should use the most recent change at or before the beat', () => {
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 8, numerator: 3, denominator: 4 },
        ];
        expect(getTimeSignatureAtBeat(changes, 8, 4, 4)).toEqual({ numerator: 3, denominator: 4 });
        expect(getTimeSignatureAtBeat(changes, 20, 4, 4)).toEqual({ numerator: 3, denominator: 4 });
    });
});

describe('getBarBeatAtPosition', () => {
    it('should map beat zero in 4/4 with no changes to bar 1 beat 1', () => {
        const pos = getBarBeatAtPosition([], 0, 4, 4);
        expect(pos.bar).toBe(1);
        expect(pos.beat).toBe(1);
        expect(pos.tick).toBe(0);
    });
});
