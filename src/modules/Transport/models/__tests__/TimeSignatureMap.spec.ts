import { describe, it, expect } from 'vitest';

import {
    createTimeSignatureChange,
    getBarBeatAtPosition,
    getMetricalBeatsBetween,
    getPrecedingBars,
    getTimeSignatureAtBeat,
    getTimeSignatureSegmentAtBeat,
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

describe('getTimeSignatureSegmentAtBeat', () => {
    it('reports the governing change beat as the grid origin and the next change as the bound', () => {
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 5, numerator: 3, denominator: 4 },
            { id: 'b', beat: 14, numerator: 7, denominator: 8 },
        ];

        expect(getTimeSignatureSegmentAtBeat(changes, 9, 4, 4)).toEqual({
            startBeat: 5,
            numerator: 3,
            denominator: 4,
            endBeat: 14,
            beatUnit: 1,
        });
    });

    it('falls back to the origin and the default meter before the first change', () => {
        const changes: TimeSignatureChange[] = [{ id: 'a', beat: 5, numerator: 3, denominator: 4 }];

        expect(getTimeSignatureSegmentAtBeat(changes, 2, 6, 8)).toEqual({
            startBeat: 0,
            numerator: 6,
            denominator: 8,
            endBeat: 5,
            beatUnit: 0.5,
        });
    });

    it('runs to infinity in the last segment', () => {
        expect(getTimeSignatureSegmentAtBeat([], 100, 4, 4).endBeat).toBe(Number.POSITIVE_INFINITY);
    });
});

describe('getMetricalBeatsBetween', () => {
    it('steps whole quarter notes in 4/4', () => {
        expect(getMetricalBeatsBetween([], 0.5, 4.2, 4, 4)).toEqual([1, 2, 3, 4]);
    });

    it('steps the eighth in 6/8, matching the pulse the count-in gives the same meter', () => {
        // The count-in advances by (4 / denominator) quarter notes per beat. A
        // whole-quarter step here handed the musician an eighth-note count-off and
        // then halved the click rate at the recording downbeat.
        expect(getMetricalBeatsBetween([], 0, 3, 6, 8)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    });

    it('lands on every 7/8 bar line, not every other one', () => {
        // A 7/8 bar is 3.5 quarter notes, so bar lines fall at 0, 3.5, 7, 10.5.
        // An integer-quarter grid only ever reaches the even ones.
        const beats = getMetricalBeatsBetween([], 0, 11, 7, 8);

        for (const barLine of [0, 3.5, 7, 10.5]) {
            expect(beats).toContain(barLine);
            expect(getBarBeatAtPosition([], barLine, 7, 8)).toMatchObject({ beat: 1, tick: 0 });
        }
    });

    it('restarts the grid at a change instead of carrying the outgoing one across', () => {
        // 4/4 to beat 5, then 3/8 (an eighth-note pulse) from beat 5. The change
        // opens a bar at its own beat, so the grid re-anchors there.
        const changes: TimeSignatureChange[] = [{ id: 'a', beat: 5, numerator: 3, denominator: 8 }];

        expect(getMetricalBeatsBetween(changes, 4, 7, 4, 4)).toEqual([4, 5, 5.5, 6, 6.5, 7]);
    });

    it('returns nothing rather than hanging on a corrupt denominator', () => {
        expect(getMetricalBeatsBetween([], 0, 8, 4, 0)).toEqual([]);
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
        // The forward grid opens 4/4 bars at 0 and 4, then the change opens one at
        // 6, so the bar ending at 6 is the truncated two-quarter bar starting at 4.
        // Subtracting a whole 4/4 bar from 6 would answer 2, which is not a bar
        // line on any grid.
        expect(getPrecedingBars(changes, 6, 1, 4, 4)).toEqual([{ startBeat: 4, numerator: 4, denominator: 4 }]);
    });

    it('snaps every start to the forward grid when a change lands mid-bar', () => {
        // 4/4 from the origin with 3/4 arriving at beat 5 — one quarter into the
        // second bar. Forward bar lines: 0, 4, 5, 8, 11. Walking back from 11 by
        // subtracting bar lengths gives 8, 5, then 1: three quarter notes early,
        // and 1 is not a bar line at all. Nothing snaps a change to a bar line —
        // addTimeSignatureChange does not, and moving or deleting a range can
        // leave one mid-bar — so this is reachable, not hypothetical.
        const changes: TimeSignatureChange[] = [{ id: 'a', beat: 5, numerator: 3, denominator: 4 }];

        expect(getPrecedingBars(changes, 11, 3, 4, 4)).toEqual([
            { startBeat: 4, numerator: 4, denominator: 4 },
            { startBeat: 5, numerator: 3, denominator: 4 },
            { startBeat: 8, numerator: 3, denominator: 4 },
        ]);
    });

    it('agrees with getBarBeatAtPosition about where bars begin', () => {
        // The round trip: every start the backward walk reports must read as the
        // first beat of a bar when looked up going forward. This is the contract
        // the doc claims and the property a per-case expectation cannot pin.
        const changes: TimeSignatureChange[] = [
            { id: 'a', beat: 5, numerator: 3, denominator: 4 },
            { id: 'b', beat: 14, numerator: 7, denominator: 8 },
            { id: 'c', beat: 20.5, numerator: 5, denominator: 16 },
        ];

        for (const from of [11, 14, 17.5, 20.5, 22, 23.75]) {
            for (const bar of getPrecedingBars(changes, from, 4, 4, 4)) {
                const position = getBarBeatAtPosition(changes, bar.startBeat, 4, 4);
                expect({ from, startBeat: bar.startBeat, beat: position.beat, tick: position.tick }).toEqual({
                    from,
                    startBeat: bar.startBeat,
                    beat: 1,
                    tick: 0,
                });
            }
        }
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
