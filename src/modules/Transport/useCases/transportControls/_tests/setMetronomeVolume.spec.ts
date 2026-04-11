import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMetronomeVolume } from '../setMetronomeVolume';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setMetronomeVolume', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp metronome volume between 0 and 1', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
        vi.mocked(updateTransportState).mockImplementation(update);

        setMetronomeVolume(1.5);

        expect(update).toHaveBeenCalledWith({ metronomeVolume: 1 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        setMetronomeVolume(0.5);

        expect(update).not.toHaveBeenCalled();
    });
});
