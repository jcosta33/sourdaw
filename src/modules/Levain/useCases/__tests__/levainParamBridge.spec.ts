import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { levainBridge } from '../levainParamBridge/levainBridge';
import { registerLevainDevice } from '../levainParamBridge/registerLevainDevice';
import { unregisterLevainDevice } from '../levainParamBridge/unregisterLevainDevice';

describe('levainParamBridge', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('registers a device by id and exposes it through the bridge singleton', async () => {
        const getAllTracks = vi.fn(() => []);
        const persistDeviceParam = vi.fn();
        const autoLoadLevainSamples = vi.fn().mockResolvedValue(undefined);
        const resolveEligibleDeviceWriteTarget = vi.fn((deviceId: string) => ({
            status: 'eligible' as const,
            trackId: 'track-1',
            deviceId,
        }));
        injectDependencies(levainBridge, {
            getAllTracks,
            persistDeviceParam,
            autoLoadLevainSamples,
            resolveEligibleDeviceWriteTarget,
        });

        const mockDevice = { setParam: vi.fn(), handleCc: vi.fn() };
        await registerLevainDevice('levain-device-1', mockDevice, undefined);

        const bridge = levainBridge();
        expect(bridge).toBeDefined();
        unregisterLevainDevice('levain-device-1');
    });
});
