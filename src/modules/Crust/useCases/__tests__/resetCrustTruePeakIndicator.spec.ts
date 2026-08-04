import { describe, it, expect, beforeEach, vi } from 'vitest';

import { crustStore, defaultCrustState } from '../../stores/crustStore';
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
        crustStore.set({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Hot patch', uiLevel: 4 },
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

    it('should reset only the true peak indicator fields', () => {
        resetCrustTruePeakIndicator();

        expect(crustStore.value).toEqual({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Hot patch', uiLevel: 4 },
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
    });

    it('should not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => resetCrustTruePeakIndicator()).not.toThrow();
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
        expect(crustStore.value?.truepeakMax).toBe(-100);
    });
});
