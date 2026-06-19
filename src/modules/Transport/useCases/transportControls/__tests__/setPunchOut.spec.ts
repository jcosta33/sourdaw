import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setPunchOut } from '../setPunchOut';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

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

        // Out clamps to 0; since 0 <= in (4), the in-point is pulled back so in < out holds.
        expect(update).toHaveBeenCalledWith({ punchOutBeat: 0, punchInBeat: 0 });
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

    it('should not update when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchOut(8);

        expect(update).not.toHaveBeenCalled();
    });
});
