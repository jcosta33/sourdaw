import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleMetronome } from '../toggleMetronome';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('toggleMetronome', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should flip metronomeEnabled when transport state exists', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, metronomeEnabled: false });
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleMetronome();

        expect(update).toHaveBeenCalledWith({ metronomeEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        toggleMetronome();

        expect(update).not.toHaveBeenCalled();
    });
});
