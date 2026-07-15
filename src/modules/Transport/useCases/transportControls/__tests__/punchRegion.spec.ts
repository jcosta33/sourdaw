import { describe, expect, it } from 'vitest';

import { createPunchRegionPatch } from '../punchRegion';

describe('createPunchRegionPatch', () => {
    it.each([
        { edge: 'in', beat: Number.NaN },
        { edge: 'in', beat: Number.POSITIVE_INFINITY },
        { edge: 'in', beat: Number.NEGATIVE_INFINITY },
        { edge: 'out', beat: Number.NaN },
        { edge: 'out', beat: Number.POSITIVE_INFINITY },
        { edge: 'out', beat: Number.NEGATIVE_INFINITY },
    ] as const)('rejects $edge edge beat $beat with no patch', ({ edge, beat }) => {
        expect(
            createPunchRegionPatch({
                current: { punchInBeat: 4, punchOutBeat: 12 },
                beat,
                edge,
            })
        ).toBeNull();
    });
});
