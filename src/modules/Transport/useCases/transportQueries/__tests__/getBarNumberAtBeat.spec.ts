import { describe, expect, it } from 'vitest';

import { formatMusicalPosition } from '../formatMusicalPosition';
import { getBarNumberAtBeat } from '../getBarNumberAtBeat';

const fourFour = { changes: [], defaultNumerator: 4, defaultDenominator: 4 };
const threeFourFromBeat8 = { ...fourFour, changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] };

const rows = [
    { name: '4/4 at beat 0', meter: fourFour, beat: 0, bar: 1 },
    { name: '4/4 just before the bar line', meter: fourFour, beat: 3.99, bar: 1 },
    { name: '4/4 on the bar line', meter: fourFour, beat: 4, bar: 2 },
    { name: '4/4 a hair under the bar line snaps onto it', meter: fourFour, beat: 4 - 1e-9, bar: 2 },
    { name: '3/4 default meter', meter: { ...fourFour, defaultNumerator: 3 }, beat: 9, bar: 4 },
    { name: 'before a 3/4 change', meter: threeFourFromBeat8, beat: 7.5, bar: 2 },
    { name: 'on the first 3/4 bar line after the change', meter: threeFourFromBeat8, beat: 11, bar: 4 },
    { name: 'inside the third 3/4 bar after the change', meter: threeFourFromBeat8, beat: 14.5, bar: 5 },
    { name: 'a hair under a 3/4 bar line snaps onto it', meter: threeFourFromBeat8, beat: 11 - 1e-9, bar: 4 },
];

describe('getBarNumberAtBeat', () => {
    it.each(rows)('$name', ({ meter, beat, bar }) => {
        expect(getBarNumberAtBeat({ ...meter, beat })).toBe(bar);
        expect(Number(formatMusicalPosition({ ...meter, beat }).split('.')[0])).toBe(bar);
    });
});
