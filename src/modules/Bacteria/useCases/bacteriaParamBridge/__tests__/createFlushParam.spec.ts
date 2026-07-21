import { describe, it, expect, vi } from 'vitest';

import { type resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { createFlushParam } from '../createFlushParam';
import { type BacteriaBatchEntry, type PersistDeviceParamFn, type UpdateDeviceParamFn } from '../helpers';

describe('createFlushParam', () => {
    it('should update the engine before persisting the same payload', () => {
        const calls: string[] = [];
        const updateDeviceParam = vi.fn<UpdateDeviceParamFn>((trackId, deviceId, key, value) => {
            calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
        });
        const persistDeviceParam = vi.fn<PersistDeviceParamFn>((deviceId, key, value) => {
            calls.push(`persist:${deviceId}:${key}:${value}`);
        });
        const entry = {
            deviceId: 'device-1',
            key: 'drive',
            value: 0.75,
        } satisfies BacteriaBatchEntry;

        const resolveTarget = vi.fn<typeof resolveEligibleDeviceWriteTarget>(() => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        }));
        const flushParam = createFlushParam(updateDeviceParam, persistDeviceParam, resolveTarget);

        flushParam('device-1:drive', entry);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'drive', 0.75);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'drive', 0.75);
        expect(calls).toEqual(['update:track-1:device-1:drive:0.75', 'persist:device-1:drive:0.75']);
    });

    it('drops a queued value when ownership is no longer eligible', () => {
        const updateDeviceParam = vi.fn<UpdateDeviceParamFn>();
        const persistDeviceParam = vi.fn<PersistDeviceParamFn>();
        const resolveTarget = vi.fn<typeof resolveEligibleDeviceWriteTarget>(() => ({ status: 'ineligible' }));
        const flushParam = createFlushParam(updateDeviceParam, persistDeviceParam, resolveTarget);

        flushParam('device-1:drive', { deviceId: 'device-1', key: 'drive', value: 0.75 });

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
