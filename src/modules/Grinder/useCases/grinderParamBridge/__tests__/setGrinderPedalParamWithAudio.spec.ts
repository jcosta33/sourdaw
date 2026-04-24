import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setGrinderPedalParam } from '../../../stores/grinderStore';
import { setGrinderPedalParamWithAudio } from '../setGrinderPedalParamWithAudio';

vi.mock('../../../stores/grinderStore', () => ({
    setGrinderPedalParam: vi.fn(),
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

describe('setGrinderPedalParamWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update store and schedule audio engine update for pedals', () => {
        const deviceId = 'device-1';
        deps.getAllTracks.mockReturnValue([
            {
                id: 'track-1',
                devices: [{ id: deviceId, type: 'grinder' }],
            },
        ]);

        const action = setGrinderPedalParamWithAudio(deps as any);
        const defaults = { id: 'od1', type: 'overdrive', enabled: true, params: {} } as any;

        action(deviceId, false, 'overdrive', 'drive', 4.5, defaults);

        expect(setGrinderPedalParam).toHaveBeenCalledWith(deviceId, false, 'overdrive', 'drive', 4.5, defaults);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith(expect.anything(), deviceId, 'preOverdriveDrive', 4.5);
    });
});
