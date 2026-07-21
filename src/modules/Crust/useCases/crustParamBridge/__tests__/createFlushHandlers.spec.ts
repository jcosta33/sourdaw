import { describe, it, expect, vi } from 'vitest';

import { createFlushHandlers } from '../createFlushHandlers';
import { type BridgeDeps, type CrustBatchEntry } from '../helpers';

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
            key: 'ceiling',
            value: -0.3,
        } satisfies CrustBatchEntry;

        const { flushParam } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
        });

        flushParam('device-1:ceiling', entry);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'ceiling', -0.3);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'ceiling', -0.3);
        expect(calls).toEqual(['update:track-1:device-1:ceiling:-0.3', 'persist:device-1:ceiling:-0.3']);
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
        });

        pushParamImmediately('device-1', 'gain', 6);

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'device-1', 'gain', 6);
        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'gain', 6);
        expect(calls).toEqual(['update:track-1:device-1:gain:6', 'persist:device-1:gain:6']);
    });

    it('drops queued work when the owner becomes ineligible before flush', () => {
        const updateDeviceParam = vi.fn<BridgeDeps['updateDeviceParam']>();
        const persistDeviceParam = vi.fn<BridgeDeps['persistDeviceParam']>();
        const resolveEligibleDeviceWriteTarget = vi.fn<BridgeDeps['resolveEligibleDeviceWriteTarget']>(() => ({
            status: 'ineligible',
        }));
        const { flushParam } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
        });

        flushParam('device-1:gain', { deviceId: 'device-1', key: 'gain', value: 4 });

        expect(resolveEligibleDeviceWriteTarget).toHaveBeenCalledWith('device-1');
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
