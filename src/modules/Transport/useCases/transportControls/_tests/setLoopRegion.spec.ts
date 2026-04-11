import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setLoopRegion } from '../setLoopRegion';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
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

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        setLoopRegion(0, 8);

        expect(update).not.toHaveBeenCalled();
    });
});
