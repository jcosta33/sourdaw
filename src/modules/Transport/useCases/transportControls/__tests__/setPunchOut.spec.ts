import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setPunchOut } from '../setPunchOut';

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

describe('setPunchOut', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp punch out beat and update transport', () => {
        const update = vi.fn<typeof updateTransportState>();
        // defaultTransportState.punchInBeat is 0, so 32 is a valid forward out-point.
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(32);

        expect(update).toHaveBeenCalledWith({ punchOutBeat: 32 });
    });

    it('should clamp a negative out-point to the timeline origin and preserve a forward region', () => {
        const update = vi.fn<typeof updateTransportState>();
        // punchInBeat is 4; an out-point clamped to 0 would invert the region.
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchInBeat: 4 });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(-8);

        // No non-negative in-point can be below zero, so use the smallest positive beat.
        expect(update).toHaveBeenCalledWith({ punchOutBeat: Number.MIN_VALUE, punchInBeat: 0 });
    });

    it('should pull the in-point back when the out-point would invert the region', () => {
        const update = vi.fn<typeof updateTransportState>();
        // punchInBeat is 8; setting the out-point to 4 would invert the region
        // and silently disable punch in the scheduler (which requires in < out).
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchInBeat: 8 });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(4);

        expect(update).toHaveBeenCalledWith({ punchOutBeat: 4, punchInBeat: 3 });
    });

    it('should pull the in-point back when the out-point meets the in-point', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, punchInBeat: 8 });
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(8);

        expect(update).toHaveBeenCalledWith({ punchOutBeat: 8, punchInBeat: 7 });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'should keep a non-finite out-point out of transport state (%s)',
        (beat) => {
            const update = vi.fn<typeof updateTransportState>();
            const current = { ...defaultTransportState, punchInBeat: 4 };
            vi.mocked(getTransportState).mockReturnValue(current);
            vi.mocked(updateTransportState).mockImplementation(update);

            setPunchOut(beat);

            expect_valid_punch_region(get_updated_punch_region(update.mock.calls, current));
        }
    );

    it('should preserve the largest finite out-point without collapsing the in-point', () => {
        const update = vi.fn<typeof updateTransportState>();
        const current = { ...defaultTransportState, punchInBeat: 4 };
        vi.mocked(getTransportState).mockReturnValue(current);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(Number.MAX_VALUE);

        const next = get_updated_punch_region(update.mock.calls, current);
        expect_valid_punch_region(next);
        expect(next.punchOutBeat).toBe(Number.MAX_VALUE);
    });

    it('should repair a large finite out-point when subtracting one collapses equality', () => {
        const large_beat = Number.MAX_VALUE / 2;
        const update = vi.fn<typeof updateTransportState>();
        const current = { ...defaultTransportState, punchInBeat: large_beat, punchOutBeat: Number.MAX_VALUE };
        vi.mocked(getTransportState).mockReturnValue(current);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(large_beat);

        const next = get_updated_punch_region(update.mock.calls, current);
        expect_valid_punch_region(next);
        expect(next.punchOutBeat).toBe(large_beat);
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(8);

        expect(update).not.toHaveBeenCalled();
    });
});
