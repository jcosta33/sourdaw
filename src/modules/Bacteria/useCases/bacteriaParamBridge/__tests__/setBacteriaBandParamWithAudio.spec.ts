import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type getBacteriaState, setBacteriaBandParam } from '../../../stores/bacteriaStore';
import { setBacteriaBandParamWithAudio } from '../setBacteriaBandParamWithAudio';

const TWO_BAND_PATCH = {
    bands: [{ drive: 0 }, { drive: 0 }],
} as unknown as ReturnType<typeof getBacteriaState>['patch'];

vi.mock('../../../stores/bacteriaStore', () => ({
    setBacteriaBandParam: vi.fn(),
    getBacteriaState: vi.fn(() => ({ patch: TWO_BAND_PATCH })),
}));

vi.mock('../helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../helpers')>();
    return {
        ...actual,
        paramBatcher: {
            // Flush synchronously so engine writes are observable in-test.
            schedule: vi.fn((key, entry, flush) => flush(key, entry)),
        },
    };
});

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: unknown) => fn,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

describe('setBacteriaBandParamWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    const deviceId = 'device-1';

    beforeEach(() => {
        vi.clearAllMocks();
        deps.getAllTracks.mockReturnValue([{ id: 'track-1', devices: [{ id: deviceId, type: 'bacteria' }] }]);
    });

    it('schedules an engine write for an in-range band', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- factory pass-through via mocked inject
        const action = (setBacteriaBandParamWithAudio as any)(deps);

        action(deviceId, 1, 'drive', 30);

        expect(setBacteriaBandParam).toHaveBeenCalledWith(deviceId, 1, 'drive', 30);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', deviceId, 'band1_drive', 30);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(deviceId, 'band1_drive', 30);
    });

    it('does NOT schedule an engine write for an out-of-range band index', () => {
        // Regression: the store no-ops on an out-of-range index, but the bridge
        // previously still encoded and scheduled the engine write. The bounds
        // guard must short-circuit before any engine/persist call.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- factory pass-through via mocked inject
        const action = (setBacteriaBandParamWithAudio as any)(deps);

        action(deviceId, 5, 'drive', 30); // patch has only 2 bands (indices 0..1)

        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });

    it('does NOT schedule an engine write for a negative band index', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- factory pass-through via mocked inject
        const action = (setBacteriaBandParamWithAudio as any)(deps);

        action(deviceId, -1, 'drive', 30);

        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });
});
