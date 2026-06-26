import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setGrinderParam } from '../../../stores/grinderStore';
import { paramBatcher } from '../helpers';
import { setGrinderParamWithAudio } from '../setGrinderParamWithAudio';

vi.mock('../../../stores/grinderStore', () => ({
    setGrinderParam: vi.fn(),
    grinderStore: { value: {} },
}));

vi.mock('../helpers', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        paramBatcher: {
            schedule: vi.fn((key, entry, flush) => flush(key, entry)),
        },
    };
});

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

describe('setGrinderParamWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateDevicePatch: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update store and schedule audio engine update', () => {
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: trackId,
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const action = setGrinderParamWithAudio(deps as any);
        action(deviceId, 'gain', 8.2);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'gain', 8.2);
        expect(paramBatcher.schedule).toHaveBeenCalled();
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'gain', 8.2);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'gain', 8.2);
    });

    it('should handle boolean parameters correctly', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const action = setGrinderParamWithAudio(deps as any);
        action(deviceId, 'bright', 1);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'bright', true);
    });

    it('should also push the coupled neuralEnabled to audio when engineMode changes', () => {
        // Regression for R1: writing engineMode through the single-param path
        // updated neuralEnabled in the store but never scheduled it to the
        // device, desyncing the engine's neuralEnabled from the store.
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: trackId,
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const action = setGrinderParamWithAudio(deps as any);
        // engineMode index 1 = 'capture' (non-circuit) → neuralEnabled true → 1.
        action(deviceId, 'engineMode', 1);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'engineMode', 'capture');
        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'neuralEnabled', true);
        // Both the primary and the coupled key must reach the audio engine.
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'engineMode', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'neuralEnabled', 1);
    });

    it('should also push the coupled engineMode to audio when neuralEnabled changes', () => {
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: trackId,
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const action = setGrinderParamWithAudio(deps as any);
        // neuralEnabled true → engineMode 'hybrid' (index 2).
        action(deviceId, 'neuralEnabled', 1);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'neuralEnabled', true);
        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'engineMode', 'hybrid');
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'neuralEnabled', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'engineMode', 2);
    });
});
