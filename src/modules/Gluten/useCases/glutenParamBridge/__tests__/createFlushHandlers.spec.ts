import { describe, it, expect, vi } from 'vitest';

import { createFlushHandlers } from '../createFlushHandlers';
import { type BridgeDeps, type DeviceRef, type GlutenBatchEntry } from '../helpers';

describe('createFlushHandlers', () => {
    it('should flush the entry through update before persist with the same payload', () => {
        const calls: string[] = [];
        const updateDeviceParam = vi.fn<BridgeDeps['updateDeviceParam']>((trackId, deviceId, key, value) => {
            calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
        });
        const persistDeviceParam = vi.fn<BridgeDeps['persistDeviceParam']>((deviceId, key, value) => {
            calls.push(`persist:${deviceId}:${key}:${value}`);
        });
        const entry = {
            ref: { trackId: 'track-1', deviceId: 'device-1' },
            key: 'threshold',
            value: -18,
        } satisfies GlutenBatchEntry;

        const { flushParam } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });

        flushParam('device-1:threshold', entry);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'threshold', -18);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'threshold', -18);
        expect(calls).toEqual(['update:track-1:device-1:threshold:-18', 'persist:device-1:threshold:-18']);
    });

    it('should push immediately through update before persist with the same payload', () => {
        const calls: string[] = [];
        const updateDeviceParam = vi.fn<BridgeDeps['updateDeviceParam']>((trackId, deviceId, key, value) => {
            calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
        });
        const persistDeviceParam = vi.fn<BridgeDeps['persistDeviceParam']>((deviceId, key, value) => {
            calls.push(`persist:${deviceId}:${key}:${value}`);
        });
        const ref = { trackId: 'track-1', deviceId: 'device-1' } satisfies DeviceRef;

        const { pushParamImmediately } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });

        pushParamImmediately(ref, 'attack', 12);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'attack', 12);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'attack', 12);
        expect(calls).toEqual(['update:track-1:device-1:attack:12', 'persist:device-1:attack:12']);
    });
});
