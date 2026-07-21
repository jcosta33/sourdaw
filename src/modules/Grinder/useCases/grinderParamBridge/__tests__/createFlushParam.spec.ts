import { describe, expect, it, vi } from 'vitest';

import { createFlushParam } from '../createFlushParam';

describe('createFlushParam', () => {
    it('should forward runtime and persisted parameter writes', () => {
        const updateDeviceParamFn = vi.fn();
        const persistDeviceParamFn = vi.fn();
        const resolveEligibleDeviceWriteTargetFn = vi.fn(() => ({
            status: 'eligible' as const,
            trackId: 'track-1',
            deviceId: 'device-1',
        }));
        const flushParam = createFlushParam({
            updateDeviceParamFn,
            persistDeviceParamFn,
            resolveEligibleDeviceWriteTargetFn,
        });

        flushParam('device-1:gain', {
            deviceId: 'device-1',
            key: 'gain',
            value: 7.5,
        });

        expect(updateDeviceParamFn).toHaveBeenCalledWith('track-1', 'device-1', 'gain', 7.5);
        expect(persistDeviceParamFn).toHaveBeenCalledWith('device-1', 'gain', 7.5);
    });
});
