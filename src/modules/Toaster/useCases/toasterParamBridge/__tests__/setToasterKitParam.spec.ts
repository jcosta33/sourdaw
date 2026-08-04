import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const { mockResolveDeviceTarget, mockGetTrackStrip, mockUpdateKit } = vi.hoisted(() => ({
    mockResolveDeviceTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(),
    mockGetTrackStrip: vi.fn(),
    mockUpdateKit: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

// Keep the store write a no-op-on-absent path out of the way: updateKit only
// touches the store, which does not affect the worklet-coalescing assertions.
vi.mock('../../../stores/toasterStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/toasterStore')>()),
    updateKit: mockUpdateKit,
}));

import { setToasterKitParam } from '../setToasterKitParam';

describe('setToasterKitParam', () => {
    it('should export setToasterKitParam', () => {
        expect(setToasterKitParam).toBeDefined();
        const time = typeof setToasterKitParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

describe('setToasterKitParam rAF coalescing', () => {
    let rafCallbacks: FrameRequestCallback[];
    let rafSpy: MockInstance<typeof requestAnimationFrame>;
    let setParam: ReturnType<typeof vi.fn>;

    function flushFrame(): void {
        const callbacks = rafCallbacks;
        rafCallbacks = [];
        for (const cb of callbacks) {
            cb(0);
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        rafCallbacks = [];
        rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });

        setParam = vi.fn();
        mockResolveDeviceTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'dev-1',
        });
        // Real device nodes always carry an id (`BuiltinDeviceNode.deviceId` is
        // required). Omitting it here is what let a selector that ignored
        // `deviceId` look correct against this fixture.
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: true, setParam } }],
        });
    });

    afterEach(() => {
        rafSpy.mockRestore();
    });

    it('flushes the kit param to the addressed Toaster, not the first one on the track', () => {
        // A track can host two Toasters. The flush had `entry.deviceId` in scope
        // and threw it away, taking whichever node exposed toaster controls
        // first — so dragging Swing on the second panel retuned the first.
        const otherSetParam = vi.fn();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [
                { deviceId: 'dev-other', toasterControls: { ready: true, setParam: otherSetParam } },
                { deviceId: 'dev-1', toasterControls: { ready: true, setParam } },
            ],
        });

        setToasterKitParam('dev-1', 'swing', 0.42);
        flushFrame();

        expect(setParam).toHaveBeenCalledWith('swing', 0.42);
        expect(otherSetParam).not.toHaveBeenCalled();
    });

    it('still writes through a Toaster that is not ready yet, because the placeholder buffers and replays', () => {
        // Deliberate asymmetry with the pad-param paths. A loading Toaster's
        // placeholder controller pushes `setParam` into `pendingParams` and the
        // loader replays the buffer once the worklet is up
        // (AudioEngine/engine/wasmDeviceRegistry.ts). Gating this flush on
        // `ready` would silently discard every kit edit made during load.
        const loadingSetParam = vi.fn();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: false, setParam: loadingSetParam } }],
        });

        setToasterKitParam('dev-1', 'masterGain', 0.6);
        flushFrame();

        expect(loadingSetParam).toHaveBeenCalledWith('master_gain', 0.6);
    });

    it('coalesces rapid writes of one param into a single worklet write', () => {
        // Regression: kit params used to write the worklet synchronously on every
        // call, flooding it at full pointer-event rate. They must coalesce via rAF
        // like pad params do.
        setToasterKitParam('dev-1', 'swing', 0.1);
        setToasterKitParam('dev-1', 'swing', 0.2);
        setToasterKitParam('dev-1', 'swing', 0.3);

        // No synchronous worklet writes; exactly one frame scheduled.
        expect(setParam).not.toHaveBeenCalled();
        expect(rafSpy).toHaveBeenCalledTimes(1);

        flushFrame();

        // One write, carrying only the latest value.
        expect(setParam).toHaveBeenCalledTimes(1);
        expect(setParam).toHaveBeenCalledWith('swing', 0.3);
    });

    it('maps the kit key to the worklet param name on flush', () => {
        setToasterKitParam('dev-1', 'masterGain', 0.8);
        flushFrame();
        expect(setParam).toHaveBeenCalledWith('master_gain', 0.8);
    });

    it('does not schedule a frame when the device is not on any track', () => {
        mockResolveDeviceTarget.mockReturnValue({ status: 'missing' });
        setToasterKitParam('dev-1', 'swing', 0.5);
        expect(mockUpdateKit).not.toHaveBeenCalled();
        expect(rafSpy).not.toHaveBeenCalled();
        expect(setParam).not.toHaveBeenCalled();
    });

    it('drops a queued write when the owner becomes ineligible before the frame flushes', () => {
        setToasterKitParam('dev-1', 'swing', 0.5);
        mockResolveDeviceTarget.mockReturnValue({ status: 'ineligible' });

        flushFrame();

        expect(mockGetTrackStrip).not.toHaveBeenCalled();
        expect(setParam).not.toHaveBeenCalled();
    });
});
