import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { getGrinderState, grinderStore } from '../../../stores/grinderStore';
import { paramBatcher } from '../helpers';
import { setGrinderParamWithAudio } from '../setGrinderParamWithAudio';

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
        value: { tracks: [{ id: 'track-1', devices: [{ id: 'device-1', type: 'grinder' }] }] },
        subscribe: vi.fn(() => () => undefined),
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
    updateDevicePatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    persistDeviceParam: mocks.persistDeviceParam,
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

describe('setGrinderParamWithAudio engineMode/neuralEnabled flush order', () => {
    let rafQueue: Array<FrameRequestCallback>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
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

    it('flushes the coupled neuralEnabled before a written engineMode', () => {
        // neuralEnabled and engineMode both write NeuralCapture's single
        // engine_mode field. Emitting engineMode first let the boolean
        // simplification overwrite the exact pick: selecting Capture ran
        // Hybrid (issue #4141).
        setGrinderParamWithAudio(DEVICE_ID, 'engineMode', 1);

        expect(getGrinderState(DEVICE_ID).patch.engineMode).toBe('capture');
        expect(getGrinderState(DEVICE_ID).patch.neuralEnabled).toBe(true);
        expect(paramBatcher.pendingSize).toBe(2);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();

        runPendingRaf();

        expect(mocks.updateDeviceParam.mock.calls).toEqual([
            [TRACK_ID, DEVICE_ID, 'neuralEnabled', 1],
            [TRACK_ID, DEVICE_ID, 'engineMode', 1],
        ]);
        expect(mocks.persistDeviceParam.mock.calls).toEqual([
            [DEVICE_ID, 'neuralEnabled', 1],
            [DEVICE_ID, 'engineMode', 1],
        ]);
    });

    it('flushes a written neuralEnabled before its coupled engineMode', () => {
        setGrinderParamWithAudio(DEVICE_ID, 'neuralEnabled', 1);

        runPendingRaf();

        expect(mocks.updateDeviceParam.mock.calls).toEqual([
            [TRACK_ID, DEVICE_ID, 'neuralEnabled', 1],
            [TRACK_ID, DEVICE_ID, 'engineMode', 2],
        ]);
        expect(mocks.persistDeviceParam.mock.calls).toEqual([
            [DEVICE_ID, 'neuralEnabled', 1],
            [DEVICE_ID, 'engineMode', 2],
        ]);
    });

    it('leaves uncoupled keys untouched by the ordering law', () => {
        setGrinderParamWithAudio(DEVICE_ID, 'gain', 8.2);

        runPendingRaf();

        expect(mocks.updateDeviceParam.mock.calls).toEqual([[TRACK_ID, DEVICE_ID, 'gain', 8.2]]);
        expect(mocks.persistDeviceParam.mock.calls).toEqual([[DEVICE_ID, 'gain', 8.2]]);
    });
});
