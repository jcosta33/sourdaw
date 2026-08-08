import { describe, it, expect, vi } from 'vitest';

import { createFlushHandlers } from '../createFlushHandlers';
import { type BridgeDeps, type GlutenBatchEntry } from '../helpers';

describe('createFlushHandlers', () => {
    it('should flush the entry through update before persist with the same payload', () => {
        const calls: string[] = [];
        const updateDeviceParam = vi.fn<BridgeDeps['updateDeviceParam']>((trackId, deviceId, key, value) => {
            calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
        });
        const persistDeviceParam = vi.fn<BridgeDeps['persistDeviceParam']>((deviceId, key, value) => {
            calls.push(`persist:${deviceId}:${key}:${value}`);
        });
        const resolveEligibleDeviceWriteTarget = vi.fn<BridgeDeps['resolveEligibleDeviceWriteTarget']>(() => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        }));
        const entry = {
            deviceId: 'device-1',
            key: 'threshold',
            value: -18,
        } satisfies GlutenBatchEntry;

        const { flushParam } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            executeAppAction: vi.fn(() => Promise.resolve()),
        });

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
        const resolveEligibleDeviceWriteTarget = vi.fn<BridgeDeps['resolveEligibleDeviceWriteTarget']>(() => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'device-1',
        }));

        const { pushParamImmediately } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            executeAppAction: vi.fn(() => Promise.resolve()),
        });

        pushParamImmediately('device-1', 'attack', 12);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'attack', 12);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'attack', 12);
        expect(calls).toEqual(['update:track-1:device-1:attack:12', 'persist:device-1:attack:12']);
    });

    it('drops queued work when the owner becomes missing before flush', () => {
        const updateDeviceParam = vi.fn<BridgeDeps['updateDeviceParam']>();
        const persistDeviceParam = vi.fn<BridgeDeps['persistDeviceParam']>();
        const resolveEligibleDeviceWriteTarget = vi.fn<BridgeDeps['resolveEligibleDeviceWriteTarget']>(() => ({
            status: 'missing',
        }));
        const { flushParam } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            executeAppAction: vi.fn(() => Promise.resolve()),
        });

        flushParam('device-1:threshold', { deviceId: 'device-1', key: 'threshold', value: -10 });

        expect(resolveEligibleDeviceWriteTarget).toHaveBeenCalledWith('device-1');
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
