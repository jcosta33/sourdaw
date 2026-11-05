import { describe, expect, it } from 'vitest';

import {
    formatBarBeatSixteenth,
    formatBarBeatSixteenthLength,
    measureBarBeatSixteenthLength,
} from '../musicalPositionFormat';
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

    it('rounds a non-sixteenth float to the nearest sixteenth', () => {
        expect(formatBarBeatSixteenth([], 31.666666666666668, FOUR_FOUR)).toBe('8.4.4');
        expect(formatBarBeatSixteenth([], 35.54133333333297, FOUR_FOUR)).toBe('9.4.3');
    });

    it('rolls a position just under a bar line onto the next downbeat', () => {
        expect(formatBarBeatSixteenth([], 3.99, FOUR_FOUR)).toBe('2.1.1');
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
    it('reads a full 4/4 bar as 1.0.0', () => {
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength([], 0, 4, FOUR_FOUR))).toBe('1.0.0');
    });

    it('rounds a recorded length to the nearest sixteenth', () => {
        expect(
            formatBarBeatSixteenthLength(
                measureBarBeatSixteenthLength([], 31.666666666666668, 3.874666666666304, FOUR_FOUR)
            )
        ).toBe('0.3.3');
    });

    it('sizes a bar at three beats in 3/4', () => {
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength([], 0, 4, THREE_FOUR))).toBe('1.1.0');
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength([], 0, 9, THREE_FOUR))).toBe('3.0.0');
    });

    it('sizes a bar by the meter governing the start', () => {
        const changes = [meterChange];
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength(changes, 0, 6, FOUR_FOUR))).toBe('1.2.0');
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength(changes, 8, 6, FOUR_FOUR))).toBe('2.0.0');
    });

    it('reads a zero or negative length as 0.0.0', () => {
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength([], 0, 0, FOUR_FOUR))).toBe('0.0.0');
        expect(formatBarBeatSixteenthLength(measureBarBeatSixteenthLength([], 0, -1, FOUR_FOUR))).toBe('0.0.0');
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
