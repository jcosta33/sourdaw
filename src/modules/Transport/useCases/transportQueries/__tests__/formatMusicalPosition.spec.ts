import { describe, expect, it } from 'vitest';

import { formatMusicalLength } from '../formatMusicalLength';
import { formatMusicalPosition } from '../formatMusicalPosition';
import { measureMusicalLength } from '../measureMusicalLength';

const fourFour = { changes: [], defaultNumerator: 4, defaultDenominator: 4 };

describe('musical position queries', () => {
    it('format through the given 4/4 meter', () => {
        expect(formatMusicalPosition({ ...fourFour, beat: 31.666666666666668 })).toBe('8.4.4');
        expect(
            formatMusicalLength({ ...fourFour, startBeat: 31.666666666666668, lengthBeats: 3.874666666666304 })
        ).toBe('0.3.3');
    });

    it('follow the default meter', () => {
        const threeFour = { ...fourFour, defaultNumerator: 3 };

        expect(formatMusicalPosition({ ...threeFour, beat: 9 })).toBe('4.1.1');
        expect(formatMusicalLength({ ...threeFour, startBeat: 0, lengthBeats: 9 })).toBe('3.0.0');
    });

    it('follow a meter change in the map', () => {
        const changed = { ...fourFour, changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] };

        expect(formatMusicalPosition({ ...changed, beat: 11 })).toBe('4.1.1');
        expect(formatMusicalLength({ ...changed, startBeat: 8, lengthBeats: 6 })).toBe('2.0.0');
        expect(measureMusicalLength({ ...changed, startBeat: 8, lengthBeats: 6 })).toEqual({
            bars: 2,
            beats: 0,
            sixteenths: 0,
        });
    });
});
