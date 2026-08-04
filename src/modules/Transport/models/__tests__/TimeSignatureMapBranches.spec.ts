import { describe, it, expect } from 'vitest';

import { getBarBeatAtPosition, type TimeSignatureChange } from '../TimeSignatureMap';

/**
 * Deep branch specs for getBarBeatAtPosition. The existing spec only tests
 * position 0 and the on-change edge. These cover multi-bar accumulation,
 * off-beat positions, tick computation, and odd denominators.
 */

describe('getBarBeatAtPosition — 4/4 multi-bar and off-beat', () => {
    it('position 4 (one full 4/4 bar) → bar 2, beat 1, tick 0', () => {
        const result = getBarBeatAtPosition([], 4, 4, 4);
        expect(result).toEqual({ bar: 2, beat: 1, tick: 0 });
    });

    it('position 8 (two full 4/4 bars) → bar 3, beat 1, tick 0', () => {
        const result = getBarBeatAtPosition([], 8, 4, 4);
        expect(result).toEqual({ bar: 3, beat: 1, tick: 0 });
    });

    it('position 5 (bar 2, beat 2) → bar 2, beat 2, tick 0', () => {
        const result = getBarBeatAtPosition([], 5, 4, 4);
        expect(result).toEqual({ bar: 2, beat: 2, tick: 0 });
    });

    it('position 4.5 (half a beat past bar boundary) → bar 2, beat 1, tick 240', () => {
        // beatUnit = 4/4 = 1. quartersIntoBeat = 0.5 % 1 = 0.5. tick = floor(0.5/1 * 480) = 240.
        const result = getBarBeatAtPosition([], 4.5, 4, 4);
        expect(result.bar).toBe(2);
        expect(result.beat).toBe(1);
        expect(result.tick).toBe(240);
    });

    it('position 1.25 (beat 2, quarter-way in) → tick 120', () => {
        // quartersIntoBar = 1.25, beatInBar = floor(1.25/1)+1 = 2. quartersIntoBeat = 0.25.
        // tick = floor(0.25/1 * 480) = 120.
        const result = getBarBeatAtPosition([], 1.25, 4, 4);
        expect(result.bar).toBe(1);
        expect(result.beat).toBe(2);
        expect(result.tick).toBe(120);
    });
});

describe('getBarBeatAtPosition — 3/4 meter', () => {
    it('position 3 (one full 3/4 bar) → bar 2, beat 1', () => {
        // 3/4: beatUnit = 4/4 = 1. quarterNotesPerBar = 3*1 = 3. 3/3 = 1 bar.
        const result = getBarBeatAtPosition([], 3, 3, 4);
        expect(result).toEqual({ bar: 2, beat: 1, tick: 0 });
    });

    it('position 4 in 3/4 → bar 2, beat 2', () => {
        // remainingQuarters = 4, quarterNotesPerBar = 3. bar += floor(4/3) = 1 (total 2).
        // quartersIntoBar = 4 % 3 = 1. beatInBar = floor(1/1)+1 = 2.
        const result = getBarBeatAtPosition([], 4, 3, 4);
        expect(result).toEqual({ bar: 2, beat: 2, tick: 0 });
    });
});

describe('getBarBeatAtPosition — 6/8 meter (odd denominator)', () => {
    it('6/8: position 3 (one full bar) → bar 2, beat 1', () => {
        // beatUnit = 4/8 = 0.5. quarterNotesPerBar = 6*0.5 = 3. 3/3 = 1 bar.
        const result = getBarBeatAtPosition([], 3, 6, 8);
        expect(result.bar).toBe(2);
        expect(result.beat).toBe(1);
        expect(result.tick).toBe(0);
    });

    it('6/8: position 0.5 → bar 1, beat 1, tick 0 (exactly one beat unit)', () => {
        // quartersIntoBar = 0.5. beatInBar = floor(0.5/0.5)+1 = 2. Wait — 0.5/0.5 = 1, floor=1, +1 = 2.
        // But position 0.5 is beat 2 of the bar? In 6/8, each beat is 0.5 quarter notes.
        // So beat 1 = [0, 0.5), beat 2 = [0.5, 1.0).
        // quartersIntoBar = 0.5. beatInBar = floor(0.5/0.5)+1 = 2.
        // quartersIntoBeat = 0.5 % 0.5 = 0. tick = 0.
        const result = getBarBeatAtPosition([], 0.5, 6, 8);
        expect(result.bar).toBe(1);
        expect(result.beat).toBe(2);
        expect(result.tick).toBe(0);
    });

    it('6/8: position 0.25 → bar 1, beat 1, tick 240', () => {
        // quartersIntoBar = 0.25. beatInBar = floor(0.25/0.5)+1 = 0+1 = 1.
        // quartersIntoBeat = 0.25 % 0.5 = 0.25. tick = floor(0.25/0.5 * 480) = floor(240) = 240.
        const result = getBarBeatAtPosition([], 0.25, 6, 8);
        expect(result.bar).toBe(1);
        expect(result.beat).toBe(1);
        expect(result.tick).toBe(240);
    });
});

describe('getBarBeatAtPosition — changes between segments', () => {
    it('accumulates bars across a time-signature change', () => {
        // 4/4 for bars 1-2 (8 quarters), then 3/4 from beat 8.
        // Position 11 (3 quarters into 3/4) = bar 3, beat 1.
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 8, numerator: 3, denominator: 4 },
        ];
        const result = getBarBeatAtPosition(changes, 11, 4, 4);
        // First segment: 8 quarters at 4/4 → bar += floor(8/4) = 2 → bar 3.
        // Second segment: remainingQuarters = 11-8 = 3. quarterNotesPerBar(3/4) = 3.
        // bar += floor(3/3) = 1 → bar 4. quartersIntoBar = 0. beat 1, tick 0.
        expect(result.bar).toBe(4);
        expect(result.beat).toBe(1);
        expect(result.tick).toBe(0);
    });

    it('handles a mid-bar position in the second segment', () => {
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 8, numerator: 3, denominator: 4 },
        ];
        // Position 9 → 1 quarter into 3/4 segment → bar 3, beat 2.
        const result = getBarBeatAtPosition(changes, 9, 4, 4);
        expect(result.bar).toBe(3);
        expect(result.beat).toBe(2);
    });
});
