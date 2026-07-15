import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { restorePunchRegion } from '../restorePunchRegion';

vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

const FIRST_UNSAFE_INTEGER = Number.MAX_SAFE_INTEGER + 1;
const NEXT_REPRESENTABLE_LARGE_INTEGER = FIRST_UNSAFE_INTEGER + 2;
const LARGE_FINITE_BEAT_BEFORE_MAXIMUM = Number.MAX_VALUE - Number.MAX_VALUE * Number.EPSILON;

describe('restorePunchRegion', () => {
    beforeEach(() => {
        vi.mocked(updateTransportState).mockClear();
    });

    it.each([
        { punchInBeat: -0, punchOutBeat: Number.MIN_VALUE },
        { punchInBeat: 0.25, punchOutBeat: 0.5 },
        { punchInBeat: Number.MAX_SAFE_INTEGER, punchOutBeat: FIRST_UNSAFE_INTEGER },
        { punchInBeat: FIRST_UNSAFE_INTEGER, punchOutBeat: NEXT_REPRESENTABLE_LARGE_INTEGER },
        { punchInBeat: LARGE_FINITE_BEAT_BEFORE_MAXIMUM, punchOutBeat: Number.MAX_VALUE },
    ])('writes the valid pair atomically: $punchInBeat -> $punchOutBeat', (region) => {
        restorePunchRegion(region);

        expect(updateTransportState).toHaveBeenCalledOnce();
        expect(updateTransportState).toHaveBeenCalledWith(region);
    });

    it.each([
        { label: 'NaN in-point', region: { punchInBeat: Number.NaN, punchOutBeat: 4 } },
        { label: 'NaN out-point', region: { punchInBeat: 0, punchOutBeat: Number.NaN } },
        { label: 'positive infinite in-point', region: { punchInBeat: Number.POSITIVE_INFINITY, punchOutBeat: 4 } },
        { label: 'positive infinite out-point', region: { punchInBeat: 0, punchOutBeat: Number.POSITIVE_INFINITY } },
        { label: 'negative infinite in-point', region: { punchInBeat: Number.NEGATIVE_INFINITY, punchOutBeat: 4 } },
        { label: 'negative infinite out-point', region: { punchInBeat: 0, punchOutBeat: Number.NEGATIVE_INFINITY } },
        { label: 'negative in-point', region: { punchInBeat: -1, punchOutBeat: 4 } },
        { label: 'negative out-point', region: { punchInBeat: 0, punchOutBeat: -1 } },
        { label: 'equal endpoints', region: { punchInBeat: 4, punchOutBeat: 4 } },
        { label: 'inverted endpoints', region: { punchInBeat: 8, punchOutBeat: 4 } },
    ])('rejects $label without writing', ({ region }) => {
        restorePunchRegion(region);

        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
