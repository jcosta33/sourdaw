import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { loadGrinderPatch } from '../../../stores/grinderStore';
import { loadGrinderPatchWithAudio } from '../loadGrinderPatchWithAudio';

vi.mock('../../../stores/grinderStore', () => ({
    loadGrinderPatch: vi.fn(),
    migrateGrinderPatch: (param: any) => param,
    grinderStore: { value: {} },
}));

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

describe('loadGrinderPatchWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update store and notify audio engine for all sync keys', () => {
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: trackId,
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = { ...DEFAULT_PATCH, gain: 7.5 };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(loadGrinderPatch).toHaveBeenCalledWith(deviceId, expect.objectContaining({ gain: 7.5 }));
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'gain', 7.5);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'gain', 7.5);
    });

    it('should sync mic properties', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            mic1: { ...DEFAULT_PATCH.mic1, positionX: 0.8 },
            mic2: { ...DEFAULT_PATCH.mic2, enabled: true, positionY: 0.4 },
        };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic1PositionX', 0.8);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic2Enabled', 1);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'mic2PositionY', 0.4);
    });

    it('should sync the selected neural model as a real DSP slot', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const patch = {
            ...DEFAULT_PATCH,
            uiSection: 'neural' as const,
            engineMode: 'capture' as const,
            neuralEnabled: true,
            neuralModelId: 'factory-rig-b',
            neuralModelName: 'Factory Rig B',
        };
        const action = loadGrinderPatchWithAudio(deps as any);

        action(deviceId, patch);

        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'neuralModelSlot', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'neuralModelSlot', 1);
    });
});
