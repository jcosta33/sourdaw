import { describe, expect, it } from 'vitest';

import { getVersionedCommandTargetRanges } from '../getVersionedCommandTargetRanges';

function beats(...values: number[]) {
    return {
        time: values.map((value) => ({ argument: 'range', domain: 'musical' as const, unit: 'beats' as const, value })),
    };
}

describe('getVersionedCommandTargetRanges', () => {
    it('lists a span several commands write once, in the order a command first touches it', () => {
        const commands = [beats(56, 72), beats(0, 8), beats(72, 56), beats(0, 8)];

        expect(getVersionedCommandTargetRanges(commands)).toEqual([
            { startBeat: 56, endBeat: 72 },
            { startBeat: 0, endBeat: 8 },
        ]);
    });

    it('keeps spans that overlap without being the same span apart', () => {
        expect(getVersionedCommandTargetRanges([beats(56, 72), beats(56, 64), beats()])).toEqual([
            { startBeat: 56, endBeat: 72 },
            { startBeat: 56, endBeat: 64 },
        ]);
    });
});
