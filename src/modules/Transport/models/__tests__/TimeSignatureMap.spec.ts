import { describe, it, expect } from 'vitest';

import {
    createTimeSignatureChange,
    getBarBeatAtPosition,
    getPrecedingBars,
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

    it('adopts the new time signature for a position landing exactly on the change beat', () => {
        // 4/4 from beat 0, switching to 3/4 at quarter-note 2 (mid-bar under the old
        // meter). A position exactly on quarter-note 2 must be read in the NEW 3/4 bar
        // (bar 1, beat 1), not under the outgoing 4/4 numerator (which would report
        // beat 3). This discriminates `>` from the off-by-one `>=`.
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 2, numerator: 3, denominator: 4 },
        ];
        const onChange = getBarBeatAtPosition(changes, 2, 4, 4);
        expect(onChange.bar).toBe(1);
        expect(onChange.beat).toBe(1);
        expect(onChange.tick).toBe(0);

        // One quarter-note past the change is still bar 1, now beat 2 of the 3/4 bar.
        const past = getBarBeatAtPosition(changes, 3, 4, 4);
        expect(past.bar).toBe(1);
        expect(past.beat).toBe(2);
    });
});

describe('getPrecedingBars', () => {
    it('walks back whole bars of the default meter when the map is empty', () => {
        expect(getPrecedingBars([], 12, 2, 4, 4)).toEqual([
            { startBeat: 4, numerator: 4, denominator: 4 },
            { startBeat: 8, numerator: 4, denominator: 4 },
        ]);
    });

    it('sizes each bar by the meter governing it, not by the meter at the end point', () => {
        // 4/4 to beat 6, 3/4 after. The two bars before beat 12 are both 3/4.
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 6, numerator: 3, denominator: 4 },
        ];
        expect(getPrecedingBars(changes, 12, 2, 4, 4)).toEqual([
            { startBeat: 6, numerator: 3, denominator: 4 },
            { startBeat: 9, numerator: 3, denominator: 4 },
        ]);
    });

    it('gives a bar ending exactly on a change the outgoing meter', () => {
        // The change at beat 6 starts a new bar there, so the bar that *ends* at 6
        // is still 4/4 — the same rule getBarBeatAtPosition applies going forwards.
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'b', beat: 6, numerator: 3, denominator: 4 },
        ];
        expect(getPrecedingBars(changes, 6, 1, 4, 4)).toEqual([{ startBeat: 2, numerator: 4, denominator: 4 }]);
    });

    it('measures a bar in quarter notes, so the denominator decides its length', () => {
        // A 6/8 bar is six eighths = three quarter notes.
        expect(getPrecedingBars([], 12, 2, 6, 8)).toEqual([
            { startBeat: 6, numerator: 6, denominator: 8 },
            { startBeat: 9, numerator: 6, denominator: 8 },
        ]);
    });

    it('reaches back past the timeline origin rather than clamping', () => {
        // Counting in to beat 0 has to happen somewhere; the caller decides what
        // to do with a negative start, this reports the true bar line.
        expect(getPrecedingBars([], 0, 1, 4, 4)).toEqual([{ startBeat: -4, numerator: 4, denominator: 4 }]);
    });

    it('reads an unsorted change list in beat order', () => {
        const changes: TimeSignatureChange[] = [
            { id: 'b', beat: 6, numerator: 3, denominator: 4 },
            { id: 'a', beat: 0, numerator: 4, denominator: 4 },
        ];
        expect(getPrecedingBars(changes, 12, 1, 4, 4)).toEqual([{ startBeat: 9, numerator: 3, denominator: 4 }]);
    });

    it('returns nothing for a zero bar count', () => {
        expect(getPrecedingBars([], 12, 0, 4, 4)).toEqual([]);
    });
});
