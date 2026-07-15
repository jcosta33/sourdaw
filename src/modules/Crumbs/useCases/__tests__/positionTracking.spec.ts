import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { interpolateFrame } from '../interpolateFrame';
import { subscribeToPosition } from '../positionTracking';

const mocks = vi.hoisted(() => ({
    isCrumbsNativeAvailable: vi.fn<() => boolean>(),
    getCrumbsPosition: vi.fn<(instanceId: string) => Promise<number>>(),
}));

vi.mock('../../repositories/is-crumbs-native-available', () => ({
    isCrumbsNativeAvailable: mocks.isCrumbsNativeAvailable,
}));

vi.mock('../../repositories/crumbsBridge/getCrumbsPosition', () => ({
    getCrumbsPosition: mocks.getCrumbsPosition,
}));

describe('subscribeToPosition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should stay idle when native Crumbs position polling is unavailable', () => {
        mocks.isCrumbsNativeAvailable.mockReturnValue(false);
        const set_interval = vi.spyOn(globalThis, 'setInterval');
        const listener = vi.fn<(frame: number) => void>();

        const unsubscribe = subscribeToPosition('instance-1', listener);

        expect(mocks.isCrumbsNativeAvailable).toHaveBeenCalledOnce();
        expect(set_interval).not.toHaveBeenCalled();
        expect(mocks.getCrumbsPosition).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
    });
});

describe('interpolateFrame', () => {
    it('should interpolate linearly between two advancing positions', () => {
        expect(interpolateFrame(100, 200, 0)).toBe(100);
        expect(interpolateFrame(100, 200, 0.5)).toBe(150);
        expect(interpolateFrame(100, 200, 1)).toBe(200);
    });

    it('should return prev when both polled frames are equal (no movement)', () => {
        expect(interpolateFrame(100, 100, 0.5)).toBe(100);
    });

    it('should snap forward to the new reading on a backend reset (last < prev) instead of scrubbing backwards', () => {
        // Transport looped/stopped back to 0: lastPolledFrame (0) < prevPolledFrame (5000).
        // The naive `prev + (last - prev) * t` would yield a value far above 0 for any
        // t < 1, scrubbing the cursor backwards from 5000 down through the buffer.
        // The reset guard must snap straight to the new reading.
        expect(interpolateFrame(5000, 0, 0)).toBe(0);
        expect(interpolateFrame(5000, 0, 0.5)).toBe(0);
        expect(interpolateFrame(5000, 0, 1)).toBe(0);
    });

    it('should snap forward for any partial backwards jump, not just a full reset to 0', () => {
        // A negative delta of any size must not interpolate backwards mid-cycle.
        expect(interpolateFrame(2000, 1500, 0)).toBe(1500);
        expect(interpolateFrame(2000, 1500, 0.5)).toBe(1500);
    });
});
