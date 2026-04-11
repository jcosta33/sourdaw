import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { loadFermenterPatchWithAudio } from '../fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../fermenterParamBridge/setFermenterParamWithAudio';

describe('fermenterParamBridge', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('setFermenterParamWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(setFermenterParamWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        setFermenterParamWithAudio('missing-device', 'inputGain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadFermenterPatchWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(loadFermenterPatchWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        loadFermenterPatchWithAudio('missing-device', { inputGain: 1 } as never);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
