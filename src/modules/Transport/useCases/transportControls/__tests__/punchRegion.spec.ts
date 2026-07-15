import { describe, expect, it } from 'vitest';

import { create_punch_region_patch } from '../punchRegion';

describe('create_punch_region_patch', () => {
    it.each([
        { edge: 'in', beat: Number.NaN },
        { edge: 'in', beat: Number.POSITIVE_INFINITY },
        { edge: 'in', beat: Number.NEGATIVE_INFINITY },
        { edge: 'out', beat: Number.NaN },
        { edge: 'out', beat: Number.POSITIVE_INFINITY },
        { edge: 'out', beat: Number.NEGATIVE_INFINITY },
    ] as const)('rejects $edge edge beat $beat with no patch', ({ edge, beat }) => {
        expect(
            create_punch_region_patch({
                current: { punchInBeat: 4, punchOutBeat: 12 },
                beat,
                edge,
            })
        ).toBeNull();
    });
});
