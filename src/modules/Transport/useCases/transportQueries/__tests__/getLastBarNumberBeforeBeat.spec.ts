import { describe, expect, it } from 'vitest';

import { getLastBarNumberBeforeBeat } from '../getLastBarNumberBeforeBeat';

const fourFour = { changes: [], defaultNumerator: 4, defaultDenominator: 4 };
const threeFourFromBeat8 = { ...fourFour, changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] };

const rows = [
    { name: '4/4 ending on a bar line stops in the bar before', meter: fourFour, beat: 16, bar: 4 },
    { name: '4/4 ending a sixteenth past a bar line reaches that bar', meter: fourFour, beat: 16.25, bar: 5 },
    { name: '4/4 ending mid-bar', meter: fourFour, beat: 18, bar: 5 },
    { name: '4/4 ending mid-sixteenth past a bar line reaches that bar', meter: fourFour, beat: 16.1, bar: 5 },
    { name: '4/4 float noise just over a bar line still stops before it', meter: fourFour, beat: 16 + 1e-9, bar: 4 },
    { name: '3/4 change ending on a bar line', meter: threeFourFromBeat8, beat: 11, bar: 3 },
    { name: '3/4 change ending mid-bar', meter: threeFourFromBeat8, beat: 12.5, bar: 4 },
];

describe('getLastBarNumberBeforeBeat', () => {
    it.each(rows)('$name', ({ meter, beat, bar }) => {
        expect(getLastBarNumberBeforeBeat({ ...meter, beat })).toBe(bar);
    });
});
