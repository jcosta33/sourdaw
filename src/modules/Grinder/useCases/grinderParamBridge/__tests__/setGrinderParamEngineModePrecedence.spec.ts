import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { grinderStore } from '../../../stores/grinderStore';
import { paramBatcher } from '../helpers';
import { setGrinderParamWithAudio } from '../setGrinderParamWithAudio';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

const deps = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({
        status: 'eligible' as const,
        trackId: 'track-1',
        deviceId: 'device-1',
    })),
    trackStore: {
        value: { tracks: [{ id: 'track-1', devices: [{ id: 'device-1', type: 'grinder' }] }] },
        subscribe: vi.fn(() => () => undefined),
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: deps.updateDeviceParam,
    updateDevicePatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: deps.trackStore,
    persistDeviceParam: deps.persistDeviceParam,
    resolveEligibleDeviceWriteTarget: deps.resolveEligibleDeviceWriteTarget,
}));

describe('setGrinderParamWithAudio engineMode precedence', () => {
    let rafQueue: Array<FrameRequestCallback>;

    beforeEach(() => {
        vi.clearAllMocks();
        deps.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });
        grinderStore.set({});
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
        grinderStore.set({});
        vi.unstubAllGlobals();
    });

    function runPendingRaf(): void {
        const queued = rafQueue;
        rafQueue = [];
        for (const callback of queued) {
            callback(0);
        }
    }

    it('schedules and flushes neuralEnabled before engineMode when engineMode is written', () => {
        setGrinderParamWithAudio(DEVICE_ID, 'engineMode', 1);

        runPendingRaf();

        expect(deps.updateDeviceParam.mock.calls).toEqual([
            [TRACK_ID, DEVICE_ID, 'neuralEnabled', 1],
            [TRACK_ID, DEVICE_ID, 'engineMode', 1],
        ]);
        expect(deps.persistDeviceParam.mock.calls).toEqual([
            [DEVICE_ID, 'neuralEnabled', 1],
            [DEVICE_ID, 'engineMode', 1],
        ]);
    });

    it('schedules and flushes neuralEnabled before engineMode when neuralEnabled is written', () => {
        setGrinderParamWithAudio(DEVICE_ID, 'neuralEnabled', 1);

        runPendingRaf();

        expect(deps.updateDeviceParam.mock.calls).toEqual([
            [TRACK_ID, DEVICE_ID, 'neuralEnabled', 1],
            [TRACK_ID, DEVICE_ID, 'engineMode', 2],
        ]);
        expect(deps.persistDeviceParam.mock.calls).toEqual([
            [DEVICE_ID, 'neuralEnabled', 1],
            [DEVICE_ID, 'engineMode', 2],
        ]);
    });
});
