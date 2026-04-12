import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

import { setMetronomeVolume } from '../setMetronomeVolume';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));

describe('setMetronomeVolume', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should clamp metronome volume between 0 and 1', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, metronomeVolume: 0.5 });

        setMetronomeVolume(2);
        expect(updateTransportState).toHaveBeenCalledWith({ metronomeVolume: 1 });

        setMetronomeVolume(-0.5);
        expect(updateTransportState).toHaveBeenCalledWith({ metronomeVolume: 0 });
    });

    it('should not update transport when state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);
        setMetronomeVolume(0.25);
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
