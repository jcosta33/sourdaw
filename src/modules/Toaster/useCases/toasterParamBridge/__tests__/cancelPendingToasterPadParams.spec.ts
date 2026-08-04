import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

type SetPadParam = (pad: number, name: string, value: number) => void;

type ToasterControls = {
    ready: boolean;
    setPadParam: SetPadParam;
};

type TrackStrip = {
    deviceNodes: Array<{
        // Real device nodes always carry an id, and the selector keys on it so
        // a track hosting two Toasters routes each edit to the right one.
        deviceId?: string;
        toasterControls?: ToasterControls;
    }>;
};

const mockResolveDeviceTarget = vi.hoisted(() =>
    vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({ status: 'missing' }))
);
const mockGetTrackStrip = vi.hoisted(() => vi.fn<(trackId: string) => TrackStrip | undefined>());
const mockUpdatePad = vi.hoisted(() => vi.fn<(deviceId: string, padIndex: number, updates: unknown) => void>());

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

vi.mock('../../../stores/toasterStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/toasterStore')>()),
    updatePad: mockUpdatePad,
}));

import { cancelPendingToasterPadParams } from '../cancelPendingToasterPadParams';
import { setToasterPadParam } from '../setToasterPadParam';

describe('cancelPendingToasterPadParams', () => {
    let nextRafId: number;
    let rafCallbacks: Map<number, FrameRequestCallback>;
    let canceledCallbacks: FrameRequestCallback[];
    let requestAnimationFrameSpy: MockInstance<typeof requestAnimationFrame>;
    let cancelAnimationFrameSpy: MockInstance<typeof cancelAnimationFrame>;
    let setPadParamDev: ReturnType<typeof vi.fn<SetPadParam>>;
    let setPadParamDevUnderscore: ReturnType<typeof vi.fn<SetPadParam>>;
    let setPadParamDev1: ReturnType<typeof vi.fn<SetPadParam>>;
    let setPadParamDev2: ReturnType<typeof vi.fn<SetPadParam>>;

    function flushScheduledFrames(): void {
        const callbacks = [...rafCallbacks.values()];
        rafCallbacks.clear();
        for (const callback of callbacks) {
            callback(0);
        }
    }

    function flushCanceledFrames(): void {
        const callbacks = canceledCallbacks;
        canceledCallbacks = [];
        for (const callback of callbacks) {
            callback(0);
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        nextRafId = 1;
        rafCallbacks = new Map();
        canceledCallbacks = [];
        setPadParamDev = vi.fn<SetPadParam>();
        setPadParamDevUnderscore = vi.fn<SetPadParam>();
        setPadParamDev1 = vi.fn<SetPadParam>();
        setPadParamDev2 = vi.fn<SetPadParam>();

        requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            const id = nextRafId;
            nextRafId += 1;
            rafCallbacks.set(id, callback);
            return id;
        });
        cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
            const callback = rafCallbacks.get(id);
            if (callback) {
                canceledCallbacks.push(callback);
            }
            rafCallbacks.delete(id);
        });

        mockResolveDeviceTarget.mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: `track-${deviceId}`,
            deviceId,
        }));
        mockGetTrackStrip.mockImplementation((trackId) => {
            if (trackId === 'track-dev') {
                return {
                    deviceNodes: [{ deviceId: 'dev', toasterControls: { ready: true, setPadParam: setPadParamDev } }],
                };
            }
            if (trackId === 'track-dev_1') {
                return {
                    deviceNodes: [
                        { deviceId: 'dev_1', toasterControls: { ready: true, setPadParam: setPadParamDevUnderscore } },
                    ],
                };
            }
            if (trackId === 'track-dev-1') {
                return {
                    deviceNodes: [
                        { deviceId: 'dev-1', toasterControls: { ready: true, setPadParam: setPadParamDev1 } },
                    ],
                };
            }
            if (trackId === 'track-dev-2') {
                return {
                    deviceNodes: [
                        { deviceId: 'dev-2', toasterControls: { ready: true, setPadParam: setPadParamDev2 } },
                    ],
                };
            }
            return undefined;
        });
    });

    afterEach(() => {
        cancelPendingToasterPadParams('dev');
        cancelPendingToasterPadParams('dev_1');
        cancelPendingToasterPadParams('dev-1');
        cancelPendingToasterPadParams('dev-2');
        requestAnimationFrameSpy.mockRestore();
        cancelAnimationFrameSpy.mockRestore();
    });

    it('should cancel queued frames and drop latest entries for the given device', () => {
        setToasterPadParam('dev-1', 0, 'tune', 1);
        setToasterPadParam('dev-1', 1, 'decay', 0.4);

        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);

        cancelPendingToasterPadParams('dev-1');
        flushCanceledFrames();

        expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(2);
        expect(setPadParamDev1).not.toHaveBeenCalled();
    });

    it('should leave other devices queued after canceling one device', () => {
        setToasterPadParam('dev-1', 0, 'tune', 1);
        setToasterPadParam('dev-2', 0, 'tone', 0.7);

        cancelPendingToasterPadParams('dev-1');
        flushCanceledFrames();
        flushScheduledFrames();

        expect(setPadParamDev1).not.toHaveBeenCalled();
        expect(setPadParamDev2).toHaveBeenCalledTimes(1);
        expect(setPadParamDev2).toHaveBeenCalledWith(0, 'tone', 0.7);
    });

    it('should not cancel a queued write for a similarly prefixed device id', () => {
        setToasterPadParam('dev', 0, 'tune', 1);
        setToasterPadParam('dev_1', 0, 'tone', 0.7);

        cancelPendingToasterPadParams('dev');
        flushCanceledFrames();
        flushScheduledFrames();

        expect(setPadParamDev).not.toHaveBeenCalled();
        expect(setPadParamDevUnderscore).toHaveBeenCalledTimes(1);
        expect(setPadParamDevUnderscore).toHaveBeenCalledWith(0, 'tone', 0.7);
    });

    it('should prevent a post-destroy worklet write after a queued value changes', () => {
        setToasterPadParam('dev-1', 0, 'drive', 1);
        setToasterPadParam('dev-1', 0, 'drive', 8);

        cancelPendingToasterPadParams('dev-1');
        flushCanceledFrames();

        expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(1);
        expect(setPadParamDev1).not.toHaveBeenCalled();
    });
});
