import { describe, it, expect, vi } from 'vitest';

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
            ref: { trackId: 'track-1', deviceId: 'device-1' },
            key: 'drive',
            value: 0.75,
        } satisfies BacteriaBatchEntry;

        const flushParam = createFlushParam(updateDeviceParam, persistDeviceParam);

        flushParam('device-1:drive', entry);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'drive', 0.75);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'drive', 0.75);
        expect(calls).toEqual(['update:track-1:device-1:drive:0.75', 'persist:device-1:drive:0.75']);
    });
});
