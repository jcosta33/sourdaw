import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDeviceParam = vi.fn();
const persistDeviceParam = vi.fn();

vi.mock('../getFermenterDependencies', () => ({
    getFermenterDependencies: () => ({
        updateDeviceParam,
        persistDeviceParam,
        resolveEligibleDeviceWriteTarget: () => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        }),
    }),
}));

import { updateFermenterMappedParamInEngine } from '../updateFermenterMappedParamInEngine';

describe('updateFermenterMappedParamInEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps and updates the runtime without persisting an automated value', () => {
        updateFermenterMappedParamInEngine({
            deviceId: 'device-1',
            paramId: 'filterCutoff',
            value: 1_200,
        });

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'cutoff', 1_200);
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
