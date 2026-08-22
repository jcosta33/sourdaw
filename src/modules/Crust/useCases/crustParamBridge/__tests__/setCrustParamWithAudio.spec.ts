import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    persistDeviceParam: vi.fn(),
    setCrustParam: vi.fn(),
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

vi.mock('../../../stores/crustStore', () => ({
    setCrustParam: mocks.setCrustParam,
}));

import { type CrustPatch } from '../../../models/CrustPatch';
import { paramBatcher } from '../helpers';
import { setCrustParamWithAudio } from '../setCrustParamWithAudio';

describe('setCrustParamWithAudio', () => {
    let rafQueue: Array<FrameRequestCallback>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });
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
        vi.unstubAllGlobals();
    });

    function runPendingRaf(): void {
        const queued = rafQueue;
        rafQueue = [];
        for (const callback of queued) {
            callback(0);
        }
    }

    it('should skip both store and engine writes for a corrupt enum value', () => {
        const corruptAlgorithm = 'bogus' as CrustPatch['algorithm'];

        setCrustParamWithAudio(DEVICE_ID, 'algorithm', corruptAlgorithm);

        expect(mocks.setCrustParam).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.persistDeviceParam).not.toHaveBeenCalled();
        expect(paramBatcher.pendingSize).toBe(0);
    });

    it('should write the store and skip the engine for a store-only string key', () => {
        setCrustParamWithAudio(DEVICE_ID, 'streamingPreset', 'ebu_r128');

        expect(mocks.setCrustParam).toHaveBeenCalledWith('streamingPreset', 'ebu_r128');
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.persistDeviceParam).not.toHaveBeenCalled();
        expect(paramBatcher.pendingSize).toBe(0);
    });

    it('should write the store and engine for an encoded numeric value', () => {
        const calls: string[] = [];
        mocks.setCrustParam.mockImplementation((key: string, value: unknown) => {
            calls.push(`store:${key}:${String(value)}`);
        });
        mocks.updateDeviceParam.mockImplementation((trackId: string, deviceId: string, key: string, value: number) => {
            calls.push(`update:${trackId}:${deviceId}:${key}:${value}`);
        });
        mocks.persistDeviceParam.mockImplementation((deviceId: string, key: string, value: number) => {
            calls.push(`persist:${deviceId}:${key}:${value}`);
        });

        setCrustParamWithAudio(DEVICE_ID, 'gain', 5);

        expect(mocks.setCrustParam).toHaveBeenCalledWith('gain', 5);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(paramBatcher.pendingSize).toBe(1);

        runPendingRaf();

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'gain', 5);
        expect(mocks.persistDeviceParam).toHaveBeenCalledWith(DEVICE_ID, 'gain', 5);
        expect(calls).toEqual(['store:gain:5', 'update:track-1:device-1:gain:5', 'persist:device-1:gain:5']);
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before store or queue effects', (status) => {
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status });

        setCrustParamWithAudio(DEVICE_ID, 'streamingPreset', 'ebu_r128');
        setCrustParamWithAudio(DEVICE_ID, 'gain', 5);

        expect(mocks.setCrustParam).not.toHaveBeenCalled();
        expect(paramBatcher.pendingSize).toBe(0);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.persistDeviceParam).not.toHaveBeenCalled();
    });
});
