import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMasterGain } from '../setMasterGain';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { defaultTransportState } from '../../models/TransportState';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        setMasterGainValue: vi.fn(),
    };
});

describe('setMasterGain', () => {
    beforeEach(() => {
        vi.mocked(setMasterGainValue).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
    });

    it('should update store and audio engine when state exists', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setMasterGain(50);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 50 });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.5);
    });

    it('should not update when transport state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        setMasterGain(80);

        expect(setMasterGainValue).not.toHaveBeenCalled();
        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
