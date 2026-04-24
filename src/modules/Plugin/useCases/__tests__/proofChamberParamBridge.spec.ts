import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateProofChamberParam } from '../proofChamberParamBridge';

import type { getAllTracks } from '#/modules/Arrangement/useCases';
import type { updateDeviceParam } from '#/modules/AudioEngine/useCases';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn<typeof getAllTracks>().mockReturnValue([]),
    updateDeviceParam: vi.fn<typeof updateDeviceParam>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: mocks.updateDeviceParam,
}));

describe('updateProofChamberParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not call updateDeviceParam when the device is unknown', () => {
        updateProofChamberParam('missing-device', 'some_param', 0.5);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });
});
