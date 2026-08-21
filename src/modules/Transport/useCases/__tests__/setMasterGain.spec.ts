import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setMasterGainValue } from '#/modules/AudioEngine/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { defaultTransportState } from '../../models/TransportState';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { MAX_MASTER_GAIN } from '../../stores/transportStore';
import { setMasterGain } from '../setMasterGain';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');
vi.mock('#/modules/AudioEngine/useCases', () => ({
    setMasterGainValue: vi.fn(),
}));

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

    it('should clamp a negative value to 0', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setMasterGain(-10);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 0 });
        expect(setMasterGainValue).toHaveBeenCalledWith(0);
    });

    it('should clamp NaN to 0', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setMasterGain(Number.NaN);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 0 });
        expect(setMasterGainValue).toHaveBeenCalledWith(0);
    });

    it('should clamp a value above the contract maximum down to the +6 dB ceiling, not to 100', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setMasterGain(500);

        const calledWith = vi.mocked(updateTransportState).mock.calls.at(-1)?.[0];
        expect(calledWith?.masterGain).toBeCloseTo(MAX_MASTER_GAIN, 5);
        expect(setMasterGainValue).toHaveBeenCalledWith(expect.closeTo(FADER_MAX_GAIN, 5));
    });
});
