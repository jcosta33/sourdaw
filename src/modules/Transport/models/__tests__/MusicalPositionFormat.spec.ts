import { describe, expect, it } from 'vitest';

import {
    formatBarBeatSixteenth,
    formatBarBeatSixteenthLength,
    measureBarBeatSixteenthLength,
} from '../MusicalPositionFormat';
import { type TimeSignatureChange } from '../TimeSignatureMap';

const FOUR_FOUR = { defaultNumerator: 4, defaultDenominator: 4 };
const THREE_FOUR = { defaultNumerator: 3, defaultDenominator: 4 };
const meterChange: TimeSignatureChange = { id: 'ts-1', beat: 8, numerator: 3, denominator: 4 };

describe('formatBarBeatSixteenth', () => {
    it('reads the origin as 1.1.1', () => {
        expect(formatBarBeatSixteenth([], 0, FOUR_FOUR)).toBe('1.1.1');
    });

    it('counts bars from the 4/4 grid', () => {
        expect(formatBarBeatSixteenth([], 31.75, FOUR_FOUR)).toBe('8.4.4');
    });

    it('shows the sixteenth a non-sixteenth float lies in', () => {
        expect(formatBarBeatSixteenth([], 31.666666666666668, FOUR_FOUR)).toBe('8.4.3');
        expect(formatBarBeatSixteenth([], 35.54133333333297, FOUR_FOUR)).toBe('9.4.3');
    });

    it('keeps a position just under a bar line in that bar, as the ruler does', () => {
        expect(formatBarBeatSixteenth([], 3.9, FOUR_FOUR)).toBe('1.4.4');
        expect(formatBarBeatSixteenth([], 3.99, FOUR_FOUR)).toBe('1.4.4');
    });

    it('snaps a float within the same-beat tolerance of a boundary onto it', () => {
        expect(formatBarBeatSixteenth([], 3.9999999, FOUR_FOUR)).toBe('2.1.1');
        expect(formatBarBeatSixteenth([], 4.0000001, FOUR_FOUR)).toBe('2.1.1');
        expect(formatBarBeatSixteenth([], 3.99, FOUR_FOUR)).not.toBe('2.1.1');
    });

    it('counts a bar as three beats in 3/4', () => {
        expect(formatBarBeatSixteenth([], 9, THREE_FOUR)).toBe('4.1.1');
    });

    it('restarts the bar grid where a meter change lands', () => {
        const changes = [meterChange];
        expect(formatBarBeatSixteenth(changes, 8, FOUR_FOUR)).toBe('3.1.1');
        expect(formatBarBeatSixteenth(changes, 11, FOUR_FOUR)).toBe('4.1.1');
        expect(formatBarBeatSixteenth(changes, 12.5, FOUR_FOUR)).toBe('4.2.3');
    });

    it('counts sixteenths per metrical beat in 6/8', () => {
        const changes: TimeSignatureChange[] = [{ id: 'ts-2', beat: 0, numerator: 6, denominator: 8 }];
        // An eighth is two sixteenths: 0.5 quarters in is beat 2, sixteenth 1.
        expect(formatBarBeatSixteenth(changes, 0.5, FOUR_FOUR)).toBe('1.2.1');
        expect(formatBarBeatSixteenth(changes, 0.75, FOUR_FOUR)).toBe('1.2.2');
    });
});

describe('formatBarBeatSixteenthLength', () => {
    const length = (
        changes: TimeSignatureChange[],
        start: number,
        span: number,
        meter: { defaultNumerator: number; defaultDenominator: number }
    ) => formatBarBeatSixteenthLength(measureBarBeatSixteenthLength(changes, start, span, meter));

    it('reads a full 4/4 bar as 1.0.0', () => {
        expect(length([], 0, 4, FOUR_FOUR)).toBe('1.0.0');
    });

    it('floors a recorded length to the sixteenth it reaches', () => {
        expect(length([], 31.666666666666668, 3.874666666666304, FOUR_FOUR)).toBe('0.3.3');
    });

    it('sizes a bar at three beats in 3/4', () => {
        expect(length([], 0, 4, THREE_FOUR)).toBe('1.1.0');
        expect(length([], 0, 9, THREE_FOUR)).toBe('3.0.0');
    });

    it('counts each bar in the meter it lies in when the span crosses a change', () => {
        // 4/4 to beat 8, then 3/4: 0..12 is two 4/4 bars, one 3/4 bar and one beat.
        expect(length([meterChange], 0, 12, FOUR_FOUR)).toBe('3.1.0');
    });

    it('counts a span that starts mid-bar and crosses a change', () => {
        // 6..8 is two beats of 4/4, then 8..9.5 is a beat and two sixteenths of 3/4.
        expect(length([meterChange], 6, 3.5, FOUR_FOUR)).toBe('0.3.2');
    });

    it('measures a span wholly inside the later meter by that meter', () => {
        expect(length([meterChange], 8, 6, FOUR_FOUR)).toBe('2.0.0');
    });

    it('gives whole numbers in a 4/3 meter, whose beat is not a whole number of sixteenths', () => {
        const fourThree = { defaultNumerator: 4, defaultDenominator: 3 };
        // A bar is 4 * 4/3 quarters; 2 quarters is one 4/3 beat and 2/3 of a quarter (two sixteenths).
        expect(length([], 0, 2, fourThree)).toBe('0.1.2');
        expect(length([], 0, 16 / 3, fourThree)).toBe('1.0.0');
    });

    it('reads a zero or negative length as 0.0.0', () => {
        expect(length([], 0, 0, FOUR_FOUR)).toBe('0.0.0');
        expect(length([], 0, -1, FOUR_FOUR)).toBe('0.0.0');
    });
});

describe('measureBarBeatSixteenthLength', () => {
    it('returns the parts the string is made of', () => {
        expect(measureBarBeatSixteenthLength([], 0, 4, FOUR_FOUR)).toEqual({ bars: 1, beats: 0, sixteenths: 0 });
        expect(measureBarBeatSixteenthLength([], 0, 3.874666666666304, FOUR_FOUR)).toEqual({
            bars: 0,
            beats: 3,
            sixteenths: 3,
        });
    });
});
