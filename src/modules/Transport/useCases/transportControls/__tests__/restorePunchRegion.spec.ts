import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { restorePunchRegion } from '../restorePunchRegion';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

const FIRST_UNSAFE_INTEGER = Number.MAX_SAFE_INTEGER + 1;
const NEXT_REPRESENTABLE_LARGE_INTEGER = FIRST_UNSAFE_INTEGER + 2;
const LARGE_FINITE_BEAT_BEFORE_MAXIMUM = Number.MAX_VALUE - Number.MAX_VALUE * Number.EPSILON;
const CURRENT_REGION = { punchInBeat: 4, punchOutBeat: 12 };

describe('restorePunchRegion', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockReturnValue(CURRENT_REGION as TransportState);
        vi.mocked(updateTransportState).mockClear();
    });

    it.each([
        { punchInBeat: -0, punchOutBeat: Number.MIN_VALUE },
        { punchInBeat: 0.25, punchOutBeat: 0.5 },
        { punchInBeat: Number.MAX_SAFE_INTEGER, punchOutBeat: FIRST_UNSAFE_INTEGER },
        { punchInBeat: FIRST_UNSAFE_INTEGER, punchOutBeat: NEXT_REPRESENTABLE_LARGE_INTEGER },
        { punchInBeat: LARGE_FINITE_BEAT_BEFORE_MAXIMUM, punchOutBeat: Number.MAX_VALUE },
    ])('writes the valid pair atomically: $punchInBeat -> $punchOutBeat', (region) => {
        const result = restorePunchRegion({ expected: CURRENT_REGION, replacement: region });

        expect(result).toEqual({ status: 'written' });
        expect(updateTransportState).toHaveBeenCalledOnce();
        expect(updateTransportState).toHaveBeenCalledWith(region);
    });

    it('returns conflict without writing when either current endpoint differs from expected', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...CURRENT_REGION,
            punchOutBeat: 16,
        } as TransportState);

        const result = restorePunchRegion({
            expected: CURRENT_REGION,
            replacement: { punchInBeat: 20, punchOutBeat: 21 },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('returns no-write when the guarded replacement is already current', () => {
        const result = restorePunchRegion({ expected: CURRENT_REGION, replacement: CURRENT_REGION });

        expect(result).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('returns no-write when a distinct guarded replacement is already current', () => {
        const replacement = { punchInBeat: 20, punchOutBeat: 21 };
        vi.mocked(getTransportState).mockReturnValue(replacement as TransportState);

        const result = restorePunchRegion({ expected: CURRENT_REGION, replacement });

        expect(result).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('returns no-write when Transport state is unavailable', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        const result = restorePunchRegion({
            expected: CURRENT_REGION,
            replacement: { punchInBeat: 20, punchOutBeat: 21 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
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
    ])('rejects an invalid replacement with $label without writing', ({ region }) => {
        const result = restorePunchRegion({ expected: CURRENT_REGION, replacement: region });

        expect(result).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('rejects an invalid expected pair without writing', () => {
        const result = restorePunchRegion({
            expected: { punchInBeat: Number.NaN, punchOutBeat: 12 },
            replacement: CURRENT_REGION,
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
