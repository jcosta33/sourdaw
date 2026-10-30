import { describe, expect, it } from 'vitest';

import { getTimelineRulerGrid } from '../getTimelineRulerGrid';

type Meter = Parameters<typeof getTimelineRulerGrid>[0]['changes'][number];

function meter(beat: number, numerator = 4, denominator = 4): Meter {
    return { id: `meter-${beat}`, beat, numerator, denominator };
}

function grid(changes: readonly Meter[], fromBeat = 0, toBeat = 12) {
    return getTimelineRulerGrid({ changes, fromBeat, toBeat, defaultNumerator: 4, defaultDenominator: 4 });
}

describe('the canonical timeline ruler grid', () => {
    it('keeps the original empty-map grid and its metrical subdivision indexes', () => {
        const result = grid([]);
        expect(result.map(({ startBeat, bar, nominalBeats }) => ({ startBeat, bar, nominalBeats }))).toEqual([
            { startBeat: 0, bar: 1, nominalBeats: 4 },
            { startBeat: 4, bar: 2, nominalBeats: 4 },
            { startBeat: 8, bar: 3, nominalBeats: 4 },
            { startBeat: 12, bar: 4, nominalBeats: 4 },
        ]);
        expect(result[0]?.ticks).toEqual([
            { beat: 1, index: 1 },
            { beat: 2, index: 2 },
            { beat: 3, index: 3 },
        ]);
    });

    it('uses the real default denominator when the project has no authored map', () => {
        const result = getTimelineRulerGrid({
            changes: [],
            fromBeat: 0,
            toBeat: 6,
            defaultNumerator: 6,
            defaultDenominator: 8,
        });
        expect(result.map(({ startBeat, bar }) => [startBeat, bar])).toEqual([
            [0, 1],
            [3, 2],
            [6, 3],
        ]);
        expect(result[0]?.ticks).toEqual([
            { beat: 0.5, index: 1 },
            { beat: 1, index: 2 },
            { beat: 1.5, index: 3 },
            { beat: 2, index: 4 },
            { beat: 2.5, index: 5 },
        ]);
    });

    it.each([
        { numerator: 6, starts: [0, 3, 6], end: 6 },
        { numerator: 7, starts: [0, 3.5, 7], end: 7 },
    ])('reads authored $numerator/8 instead of the 4/4 default', ({ numerator, starts, end }) => {
        expect(grid([meter(0, numerator, 8)], 0, end).map(({ startBeat }) => startBeat)).toEqual(starts);
    });

    it('keeps both physical pieces of the partial bar and their repeated canonical number', () => {
        const result = grid([meter(0), meter(6)], 0, 14);
        expect(result.map(({ startBeat, endBeat, bar }) => [startBeat, endBeat, bar])).toEqual([
            [0, 4, 1],
            [4, 6, 2],
            [6, 10, 2],
            [10, 14, 3],
            [14, 14, 4],
        ]);
        expect(result[1]?.ticks).toEqual([{ beat: 5, index: 1 }]);
        expect(result[2]?.ticks).toEqual([
            { beat: 7, index: 1 },
            { beat: 8, index: 2 },
            { beat: 9, index: 3 },
        ]);
    });

    it('adopts the carried phase and an existing later meter on their exact seams', () => {
        expect(
            grid([meter(0), meter(6), meter(9, 3)], 0, 15).map(({ startBeat, bar, nominalBeats }) => [
                startBeat,
                bar,
                nominalBeats,
            ])
        ).toEqual([
            [0, 1, 4],
            [4, 2, 4],
            [6, 2, 4],
            [9, 2, 3],
            [12, 3, 3],
            [15, 4, 3],
        ]);
    });

    it('includes only the preceding clipped physical piece and bounds the final paint span', () => {
        const result = grid([meter(0), meter(6)], 5.5, 11.5);
        expect(
            result.map(({ startBeat, endBeat, bar, nominalBeats }) => [startBeat, endBeat, bar, nominalBeats])
        ).toEqual([
            [4, 6, 2, 4],
            [6, 10, 2, 4],
            [10, 11.5, 3, 4],
        ]);
        expect(result[0]?.ticks).toEqual([]);
        expect(result[2]?.ticks).toEqual([{ beat: 11, index: 1 }]);
        expect(grid([meter(0), meter(6)], 6, 7).map(({ startBeat }) => startBeat)).toEqual([6]);
    });

    it.each([
        { changes: [] as Meter[], fromBeat: 4.001, toBeat: 7, startBeat: 4, bar: 2 },
        { changes: [meter(0), meter(6)], fromBeat: 6.001, toBeat: 9, startBeat: 6, bar: 2 },
    ])(
        'keeps the physical clipped origin for viewport $fromBeat..$toBeat',
        ({ changes, fromBeat, toBeat, startBeat, bar }) => {
            const result = grid(changes, fromBeat, toBeat);
            expect(result.map(({ startBeat, endBeat, bar }) => [startBeat, endBeat, bar])).toEqual([
                [startBeat, toBeat, bar],
            ]);
            expect(result[0]?.ticks.map(({ beat }) => beat)).toEqual(changes.length === 0 ? [5, 6] : [7, 8]);
        }
    );

    it('returns finite bounded pieces for a dense valid meter grid', () => {
        const result = getTimelineRulerGrid({
            changes: [meter(0, 1, 32)],
            fromBeat: 0,
            toBeat: 1920,
            defaultNumerator: 4,
            defaultDenominator: 4,
        });

        expect(result).toHaveLength(15_361);
        expect(result[0]).toMatchObject({ startBeat: 0, endBeat: 0.125 });
        expect(result.at(-1)).toMatchObject({ startBeat: 1920, endBeat: 1920 });
        expect(
            result.every(
                ({ startBeat, endBeat, nominalBeats, ticks }) =>
                    Number.isFinite(startBeat) &&
                    Number.isFinite(endBeat) &&
                    Number.isFinite(nominalBeats) &&
                    startBeat <= endBeat &&
                    ticks.every(({ beat, index }) => Number.isFinite(beat) && Number.isFinite(index))
            )
        ).toBe(true);
    });

    it('reads a distant viewport without enumerating all preceding bars', () => {
        const result = grid([], 1_000_001, 1_000_006);
        expect(result.map(({ startBeat, bar }) => [startBeat, bar])).toEqual([
            [1_000_000, 250_001],
            [1_000_004, 250_002],
        ]);
        expect(result[1]?.endBeat).toBe(1_000_006);
    });

    it.each([
        [0, 0],
        [4, 3],
        [Number.NaN, 8],
        [0, Number.POSITIVE_INFINITY],
    ])('does not enumerate a non-advancing viewport %s..%s', (fromBeat, toBeat) => {
        expect(grid([], fromBeat, toBeat)).toEqual([]);
    });
});
