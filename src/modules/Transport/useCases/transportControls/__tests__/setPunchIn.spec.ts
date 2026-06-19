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

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as unknown as TransportState);
        vi.mocked(updateTransportState).mockImplementation(update);

        setPunchIn(4);

        expect(update).not.toHaveBeenCalled();
    });
});
