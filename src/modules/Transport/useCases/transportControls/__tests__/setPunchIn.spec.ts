import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setPunchIn } from '../setPunchIn';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

type PunchRegion = Pick<TransportState, 'punchInBeat' | 'punchOutBeat'>;

function get_updated_punch_region(calls: Array<[Partial<TransportState>]>, current: PunchRegion): PunchRegion {
    const patch = calls[0]?.[0];
    if (!patch) {
        throw new Error('Expected a transport update');
    }

    return { ...current, ...patch };
}

function expect_valid_punch_region(region: PunchRegion): void {
    expect(Number.isFinite(region.punchInBeat)).toBe(true);
    expect(Number.isFinite(region.punchOutBeat)).toBe(true);
    expect(region.punchInBeat).toBeGreaterThanOrEqual(0);
    expect(region.punchOutBeat).toBeGreaterThan(region.punchInBeat);
}

describe('setPunchIn', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp punch in beat and update transport', () => {
        const update = vi.fn();
        // defaultTransportState.punchOutBeat is 16, so 12 is a valid forward in-point.
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(12);

        expect(update).toHaveBeenCalledWith({ punchInBeat: 12 });
    });

    it('should clamp a negative in-point to the timeline origin', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(-8);

        expect(update).toHaveBeenCalledWith({ punchInBeat: 0 });
    });

    it('should push the out-point out when the in-point would invert the region', () => {
        const update = vi.fn();
        // punchOutBeat is 16; setting the in-point to 20 would invert the region
        // and silently disable punch in the scheduler (which requires in < out).
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchOutBeat: 16 });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(20);

        expect(update).toHaveBeenCalledWith({ punchInBeat: 20, punchOutBeat: 21 });
    });

    it('should push the out-point out when the in-point meets the out-point', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchOutBeat: 16 });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(16);

        expect(update).toHaveBeenCalledWith({ punchInBeat: 16, punchOutBeat: 17 });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'should reject a non-finite in-point without a repository write (%s)',
        (beat) => {
            const update = vi.fn<typeof updateTransportState>();
            const current = { ...defaultTransportState, punchOutBeat: 16 };
            vi.mocked(getTransportState).mockReturnValue(current);
            vi.mocked(updateTransportState).mockImplementation(update);

            setPunchIn(beat);

            expect(update).not.toHaveBeenCalled();
        }
    );

    it('should keep a maximum finite in-point from collapsing the out-point', () => {
        const update = vi.fn<typeof updateTransportState>();
        const current = { ...defaultTransportState, punchOutBeat: 16 };
        vi.mocked(getTransportState).mockReturnValue(current);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(Number.MAX_VALUE);

        const next = get_updated_punch_region(update.mock.calls, current);
        expect_valid_punch_region(next);
        expect(next.punchOutBeat).toBe(Number.MAX_VALUE);
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as unknown as TransportState);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(4);

        expect(update).not.toHaveBeenCalled();
    });
});
