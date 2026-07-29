import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { setFermenterDependencies } from '../fermenterDependencies';
import { loadFermenterPatchWithAudio } from '../fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../fermenterParamBridge/setFermenterParamWithAudio';

describe('fermenterParamBridge', () => {
    const getAllTracks = vi.fn(() => []);
    const persistDeviceParam = vi.fn();
    const updateDeviceParam = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        getAllTracks.mockReturnValue([]);
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            persistDeviceParam: persistDeviceParam as never,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'missing' }),
            updateDeviceParam: updateDeviceParam as never,
        });
    });

    it('setFermenterParamWithAudio does not touch the engine when the device is unknown', () => {
        setFermenterParamWithAudio('missing-device', 'oscLevel', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadFermenterPatchWithAudio does not touch the engine when the device is unknown', () => {
        loadFermenterPatchWithAudio('missing-device', { inputGain: 1 } as never);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
