import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setMasterGain } from './setMasterGain';
import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';
import { defaultTransportState } from '../models/TransportState';
import { setMasterGainValue } from '#/modules/AudioEngine/useCases/engineAccess/setMasterGainValue';

vi.mock('#/modules/AudioEngine/useCases/engineAccess/setMasterGainValue', () => ({
    setMasterGainValue: vi.fn(),
}));

describe('setMasterGain', () => {
    beforeEach(() => {
        vi.mocked(setMasterGainValue).mockClear();
    });

    it('should update store and audio engine when state exists', () => {
        const update = vi.fn();
        injectDependencies(setMasterGain, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setMasterGain(50);

        expect(update).toHaveBeenCalledWith({ masterGain: 50 });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.5);
    });

    it('should not update when transport state is missing', () => {
        injectDependencies(setMasterGain, {
            getTransportState: vi.fn(() => null),
            updateTransportState: vi.fn(),
        });

        setMasterGain(80);

        expect(setMasterGainValue).not.toHaveBeenCalled();
    });
});
