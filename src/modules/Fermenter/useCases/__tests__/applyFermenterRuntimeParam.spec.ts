import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { applyFermenterRuntimeParam } from '../applyFermenterRuntimeParam';
import { setFermenterDependencies, type FermenterDependencies } from '../fermenterDependencies';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const clampDeviceParameterValue = vi.fn<FermenterDependencies['clampDeviceParameterValue']>();
const persistDeviceParam = vi.fn<FermenterDependencies['persistDeviceParam']>();
const updateDeviceParam = vi.fn<FermenterDependencies['updateDeviceParam']>();
const resolveEligibleDeviceWriteTarget = vi.fn<FermenterDependencies['resolveEligibleDeviceWriteTarget']>();

describe('applyFermenterRuntimeParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clampDeviceParameterValue.mockReturnValue(20_000);
        resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'fermenter-1',
        });
        setFermenterDependencies({
            clampDeviceParameterValue,
            persistDeviceParam,
            updateDeviceParam,
            getAllTracks: () => [],
            resolveEligibleDeviceWriteTarget,
        });
    });

    it('maps and clamps a known parameter before updating only the engine runtime', () => {
        applyFermenterRuntimeParam({
            deviceId: 'fermenter-1',
            paramId: 'filterCutoff',
            value: 99_999,
        });

        expect(clampDeviceParameterValue).toHaveBeenCalledWith({
            deviceType: 'fermenter',
            paramId: 'filterCutoff',
            value: 99_999,
        });
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'fermenter-1', 'cutoff', 20_000);
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('warns and skips an unknown parameter', () => {
        applyFermenterRuntimeParam({ deviceId: 'fermenter-1', paramId: '__unknown__', value: 1 });

        expect(logger.warn).toHaveBeenCalledWith('[Fermenter] Ignored unknown runtime param: __unknown__');
        expect(resolveEligibleDeviceWriteTarget).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('skips a device that is not an eligible runtime target', () => {
        resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible' });

        applyFermenterRuntimeParam({ deviceId: 'fermenter-1', paramId: 'filterCutoff', value: 440 });

        expect(clampDeviceParameterValue).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
