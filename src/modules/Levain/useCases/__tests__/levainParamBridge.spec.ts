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

    it('resolves levain device id from getAllTracks when registering', () => {
        const getAllTracks = vi.fn(() => [
            {
                id: 'track-1',
                devices: [{ id: 'levain-device-1', type: 'levain' }],
            },
        ]);
        const persistDeviceParam = vi.fn();
        const autoLoadLevainSamples = vi.fn().mockResolvedValue(undefined);
        injectDependencies(levainBridge, {
            getAllTracks,
            persistDeviceParam,
            autoLoadLevainSamples,
        });

        const mockDevice = { setParam: vi.fn(), handleCc: vi.fn() };
        registerLevainDevice(mockDevice, undefined);

        expect(getAllTracks).toHaveBeenCalledTimes(1);
        const bridge = levainBridge();
        expect(bridge).toBeDefined();
        unregisterLevainDevice();
    });
});
