import { describe, it, expect } from 'vitest';

import { interpolateFrame } from '../positionTracking';

describe('interpolateFrame', () => {
    it('interpolates linearly between two advancing positions', () => {
        expect(interpolateFrame(100, 200, 0)).toBe(100);
        expect(interpolateFrame(100, 200, 0.5)).toBe(150);
        expect(interpolateFrame(100, 200, 1)).toBe(200);
    });

    it('returns prev when both polled frames are equal (no movement)', () => {
        expect(interpolateFrame(100, 100, 0.5)).toBe(100);
    });

    it('snaps forward to the new reading on a backend reset (last < prev) instead of scrubbing backwards', () => {
        // Transport looped/stopped back to 0: lastPolledFrame (0) < prevPolledFrame (5000).
        // The naive `prev + (last - prev) * t` would yield a value far above 0 for any
        // t < 1, scrubbing the cursor backwards from 5000 down through the buffer.
        // The reset guard must snap straight to the new reading.
        expect(interpolateFrame(5000, 0, 0)).toBe(0);
        expect(interpolateFrame(5000, 0, 0.5)).toBe(0);
        expect(interpolateFrame(5000, 0, 1)).toBe(0);
    });

    it('snaps forward for any partial backwards jump, not just a full reset to 0', () => {
        // A negative delta of any size must not interpolate backwards mid-cycle.
        expect(interpolateFrame(2000, 1500, 0)).toBe(1500);
        expect(interpolateFrame(2000, 1500, 0.5)).toBe(1500);
    });
});
