import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    crustMeterStore,
    crustStore,
    getCrustMeters,
    getCrustState,
    setCrustParam,
    updateCrustMeters,
} from '../../stores/crustStore';
import { resetCrustTruePeakIndicator } from '../resetCrustTruePeakIndicator';

const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

describe('resetCrustTruePeakIndicator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        });
        crustStore.set({});
        crustMeterStore.set({});
        setCrustParam('device-1', 'name', 'Hot patch');
        setCrustParam('device-1', 'uiLevel', 4);
        updateCrustMeters('device-1', {
            grDb: -5,
            inputDb: -18,
            outputDb: -1,
            lufsIntegrated: -10,
            lufsShortTerm: -8,
            lufsMomentary: -6,
            lra: 9,
            truepeakMax: -0.1,
            truepeakExceeded: true,
        });
    });

    it('should reset only the true peak indicator fields of the addressed device', () => {
        resetCrustTruePeakIndicator('device-1');

        expect(getCrustMeters('device-1')).toEqual({
            grDb: -5,
            inputDb: -18,
            outputDb: -1,
            lufsIntegrated: -10,
            lufsShortTerm: -8,
            lufsMomentary: -6,
            lra: 9,
            truepeakMax: -100,
            truepeakExceeded: false,
        });
        // The patch — including the per-device disclosure level — is untouched.
        expect(getCrustState('device-1').patch.name).toBe('Hot patch');
        expect(getCrustState('device-1').patch.uiLevel).toBe(4);
    });

    it('leaves another instance’s held true-peak reading alone', () => {
        updateCrustMeters('device-2', { truepeakMax: -2.2, truepeakExceeded: true });

        resetCrustTruePeakIndicator('device-1');

        expect(getCrustMeters('device-2').truepeakMax).toBe(-2.2);
        expect(getCrustMeters('device-2').truepeakExceeded).toBe(true);
    });

    it('should not throw when Crust state is unavailable', () => {
        crustMeterStore.set(null);
        crustStore.set(null);

        expect(() => resetCrustTruePeakIndicator('device-1')).not.toThrow();
    });

    // Clearing only the store would be undone by the next meter poll: the
    // engine holds the session maximum, so the readout would come straight
    // back and the button would look inert.
    it('clears the engine-side hold as well as the store', () => {
        resetCrustTruePeakIndicator('device-1');

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'resetTruePeak', 1);
    });

    it('leaves the engine alone when the device is not an eligible write target', () => {
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'missing' });

        resetCrustTruePeakIndicator('device-1');

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(getCrustMeters('device-1').truepeakMax).toBe(-100);
    });
});
