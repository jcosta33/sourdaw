import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '#/infra/logger/appLogger';

import { applyFermenterRuntimeParam } from '../applyFermenterRuntimeParam';
import { type FermenterDependencies, setFermenterDependencies } from '../fermenterDependencies';

describe('applyFermenterRuntimeParam', () => {
    const clampDeviceParameterValue = vi.fn(() => 20_000);
    const persistDeviceParam = vi.fn();
    const resolveEligibleDeviceWriteTarget = vi.fn<FermenterDependencies['resolveEligibleDeviceWriteTarget']>(() => ({
        status: 'eligible',
        trackId: 'track-1',
        deviceId: 'fermenter-1',
    }));
    const updateDeviceParam = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'fermenter-1',
        });
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks: () => [],
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            updateDeviceParam,
        });
    });

    it('maps an already-resolved runtime value to the DSP without repeating resolution or persistence', () => {
        applyFermenterRuntimeParam({
            trackId: 'track-1',
            deviceId: 'fermenter-1',
            paramId: 'filterCutoff',
            value: 20_000,
        });

        expect(resolveEligibleDeviceWriteTarget).not.toHaveBeenCalled();
        expect(clampDeviceParameterValue).not.toHaveBeenCalled();
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'fermenter-1', 'cutoff', 20_000);
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('skips an unknown parameter before writing a device', () => {
        applyFermenterRuntimeParam({
            trackId: 'track-1',
            deviceId: 'fermenter-1',
            paramId: '__unknown__',
            value: 1,
        });

        expect(logger.warn).toHaveBeenCalledWith('[Fermenter] Ignored unknown runtime param: __unknown__');
        expect(resolveEligibleDeviceWriteTarget).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
