import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { type CrustPatch } from '../../../models/CrustPatch';
import { crustStore, defaultCrustState, setCrustParam } from '../../../stores/crustStore';
import { paramBatcher } from '../helpers';
import { setCrustParamWithAudio } from '../setCrustParamWithAudio';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({
        status: 'eligible' as const,
        trackId: 'track-1',
        deviceId: 'device-1',
    })),
    trackStore: {
        value: { tracks: [{ id: 'track-1', devices: [{ id: 'device-1', type: 'crust' }] }] },
        subscribe: vi.fn(() => () => undefined),
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    persistDeviceParam: mocks.persistDeviceParam,
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

describe('setCrustParamWithAudio style → algorithm store sync', () => {
    let rafQueue: Array<FrameRequestCallback>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });
        crustStore.set({ ...defaultCrustState });
        paramBatcher.cancelAll();
        rafQueue = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            rafQueue.push(callback);
            return rafQueue.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
            rafQueue[id - 1] = () => {};
        });
    });

    afterEach(() => {
        paramBatcher.cancelAll();
        crustStore.set({ ...defaultCrustState });
        vi.unstubAllGlobals();
    });

    function runPendingRaf(): void {
        const queued = rafQueue;
        rafQueue = [];
        for (const callback of queued) {
            callback(0);
        }
    }

    it.each([
        ['transparent', 'transparent'],
        ['punchy', 'punchy'],
        ['loud', 'wall'],
    ] as const)('should map style %s to store algorithm %s without a second engine flush', (style, algorithm) => {
        setCrustParam('algorithm', 'aggressive');
        expect(crustStore.value?.patch.algorithm).toBe('aggressive');

        setCrustParamWithAudio(DEVICE_ID, 'style', style);

        expect(crustStore.value?.patch.style).toBe(style);
        expect(crustStore.value?.patch.algorithm).toBe(algorithm);
        expect(paramBatcher.pendingSize).toBe(1);

        runPendingRaf();

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'style', expect.any(Number));
        expect(mocks.updateDeviceParam).not.toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'algorithm', expect.any(Number));
        expect(mocks.persistDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.persistDeviceParam).toHaveBeenCalledWith(DEVICE_ID, 'style', expect.any(Number));
    });

    it('should skip both store writes for an unknown style', () => {
        const corruptStyle = 'brutal' as CrustPatch['style'];

        setCrustParamWithAudio(DEVICE_ID, 'style', corruptStyle);

        expect(crustStore.value?.patch.style).toBe('transparent');
        expect(crustStore.value?.patch.algorithm).toBe('transparent');
        expect(paramBatcher.pendingSize).toBe(0);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.persistDeviceParam).not.toHaveBeenCalled();
    });
});
