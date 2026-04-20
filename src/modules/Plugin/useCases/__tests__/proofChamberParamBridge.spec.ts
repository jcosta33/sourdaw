import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateProofChamberParam } from '../proofChamberParamBridge';

const getAllTracks = vi.fn(() => []);
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: (...args: any[]) => getAllTracks(...args),
}));

const updateDeviceParam = vi.fn();
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: (...args: any[]) => updateDeviceParam(...args),
}));

describe('updateProofChamberParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not call updateDeviceParam when the device is unknown', () => {
        updateProofChamberParam('missing-device', 'some_param', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});
