import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setGrinderParamWithAudio } from '../setGrinderParamWithAudio';
import { setGrinderParam } from '../../../stores/grinderStore';
import { paramBatcher } from '../helpers';

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
}));

describe('setGrinderParamWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update store and schedule audio engine update', () => {
        const deviceId = 'device-1';
        const trackId = 'track-1';
        deps.getAllTracks.mockReturnValue([{
            id: trackId,
            devices: [{ id: deviceId, type: 'grinder' }]
        }]);

        const action = setGrinderParamWithAudio(deps as any);
        action(deviceId, 'gain', 8.2);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'gain', 8.2);
        expect(paramBatcher.schedule).toHaveBeenCalled();
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(trackId, deviceId, 'gain', 8.2);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'gain', 8.2);
    });

    it('should handle boolean parameters correctly', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([{
            id: 'track-1',
            devices: [{ id: deviceId, type: 'grinder' }]
        }]);

        const action = setGrinderParamWithAudio(deps as any);
        action(deviceId, 'bright', 1);

        expect(setGrinderParam).toHaveBeenCalledWith(deviceId, 'bright', true);
    });
});
