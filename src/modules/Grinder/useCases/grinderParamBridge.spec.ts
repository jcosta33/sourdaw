import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { loadGrinderPatchWithAudio, setGrinderParamWithAudio } from './grinderParamBridge';

describe('grinderParamBridge', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('setGrinderParamWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => []);
        injectDependencies(setGrinderParamWithAudio, {
            getAllTracks,
            updateDeviceParam,
            persistDeviceParam,
        });

        setGrinderParamWithAudio('missing-device', 'gain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadGrinderPatchWithAudio does not touch the engine when the device is unknown', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        injectDependencies(loadGrinderPatchWithAudio, {
            getAllTracks: () => [],
            updateDeviceParam,
            persistDeviceParam,
        });

        loadGrinderPatchWithAudio('missing-device', {});

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
