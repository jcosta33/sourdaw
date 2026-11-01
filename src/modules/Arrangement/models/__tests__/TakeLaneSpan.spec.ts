import { describe, expect, it } from 'vitest';

import { resolveTakeLaneSpan } from '../TakeLaneSpan';

describe('resolveTakeLaneSpan', () => {
    it('defaults to 0..16 with no clips and no takes', () => {
        expect(resolveTakeLaneSpan([], [])).toEqual({ minBeat: 0, maxBeat: 16 });
    });

    it('spans the clips when every take sits inside them', () => {
        expect(resolveTakeLaneSpan([{ startBeat: 2, endBeat: 9 }], [{ startBeat: 3, endBeat: 8 }])).toEqual({
            minBeat: 2,
            maxBeat: 9,
        });
    });

    it('widens past the clip end and before the clip start to cover a take that overhangs', () => {
        expect(
            resolveTakeLaneSpan(
                [{ startBeat: 4, endBeat: 8 }],
                [
                    { startBeat: 2, endBeat: 6 },
                    { startBeat: 6, endBeat: 12 },
                ]
            )
        ).toEqual({ minBeat: 2, maxBeat: 12 });
    });

    it('spans the takes alone when the track has no clips', () => {
        expect(resolveTakeLaneSpan([], [{ startBeat: 20, endBeat: 26 }])).toEqual({ minBeat: 20, maxBeat: 26 });
    });

    it('keeps a four-beat minimum and never starts before beat 0', () => {
        expect(resolveTakeLaneSpan([{ startBeat: -3, endBeat: 1 }], [{ startBeat: 0, endBeat: 2 }])).toEqual({
            minBeat: 0,
            maxBeat: 4,
        });
    });
});
