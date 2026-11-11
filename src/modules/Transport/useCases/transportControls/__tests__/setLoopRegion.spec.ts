import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { setLoopRegion } from '../setLoopRegion';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setLoopRegion', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should set loop bounds and enable looping', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(4, 16);

        expect(update).toHaveBeenCalledWith({ loopStart: 4, loopEnd: 16, isLooping: true });
    });

    it('can update bounds without changing loop enabled state', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isLooping: false });
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(4, 16, false);

        expect(update).toHaveBeenCalledWith({ loopStart: 4, loopEnd: 16 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(0, 8);

        expect(update).not.toHaveBeenCalled();
    });

    it('should normalise an inverted region into an ordered forward span', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(16, 4);

        // Bounds are ordered so the scheduler (which loops only when
        // loopEnd > loopStart) actually honours the region.
        expect(update).toHaveBeenCalledWith({ loopStart: 4, loopEnd: 16, isLooping: true });
    });

    it('should not enable looping for a degenerate zero-length region', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(8, 8);

        // A zero-length region cannot loop; isLooping must not be asserted true.
        expect(update).toHaveBeenCalledWith({ loopStart: 8, loopEnd: 8, isLooping: false });
    });

    it('should clamp a negative start to the timeline origin', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(-4, 8);

        expect(update).toHaveBeenCalledWith({ loopStart: 0, loopEnd: 8, isLooping: true });
    });
});
