import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const { mockFindDeviceRef, mockGetTrackStrip } = vi.hoisted(() => ({
    mockFindDeviceRef: vi.fn(() => null as { trackId: string; deviceId: string } | null),
    mockGetTrackStrip: vi.fn(),
}));

vi.mock('../helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../helpers')>();
    return { ...actual, findDeviceRef: mockFindDeviceRef };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

// Keep the store write a no-op-on-absent path out of the way: updateKit only
// touches the store, which does not affect the worklet-coalescing assertions.
vi.mock('../../../stores/toasterStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/toasterStore')>()),
    updateKit: vi.fn(),
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
        mockFindDeviceRef.mockReturnValue({ trackId: 'track-1', deviceId: 'dev-1' });
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ toasterControls: { ready: true, setParam } }],
        });
    });

    afterEach(() => {
        rafSpy.mockRestore();
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
        mockFindDeviceRef.mockReturnValue(null);
        setToasterKitParam('dev-1', 'swing', 0.5);
        expect(rafSpy).not.toHaveBeenCalled();
        expect(setParam).not.toHaveBeenCalled();
    });
});
