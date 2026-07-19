import { describe, it, expect } from 'vitest';

import { interpolateFrame } from '../interpolateFrame';

describe('interpolateFrame', () => {
    it('returns the previous frame at t=0', () => {
        expect(interpolateFrame(1000, 2000, 0)).toBe(1000);
    });

    it('returns the last polled frame at t=1', () => {
        expect(interpolateFrame(1000, 2000, 1)).toBe(2000);
    });

    it('linearly interpolates at a fractional t', () => {
        expect(interpolateFrame(1000, 2000, 0.25)).toBe(1250);
        expect(interpolateFrame(0, 100, 0.5)).toBe(50);
    });

    it('returns the flat frame when prev and last are equal, regardless of t', () => {
        expect(interpolateFrame(500, 500, 0)).toBe(500);
        expect(interpolateFrame(500, 500, 0.5)).toBe(500);
        expect(interpolateFrame(500, 500, 1)).toBe(500);
    });

    it('snaps forward to the new reading when the backend position resets backwards', () => {
        // Transport stopped/looped back to 0: lastPolledFrame (10) is below
        // prevPolledFrame (5000). Interpolating would scrub the cursor backwards
        // for one poll cycle, so the guard must snap straight to the new reading.
        expect(interpolateFrame(5000, 10, 0.5)).toBe(10);
        expect(interpolateFrame(5000, 10, 0)).toBe(10);
        expect(interpolateFrame(5000, 10, 1)).toBe(10);
    });

    it('treats a reset to exactly 0 the same as any other backward jump', () => {
        expect(interpolateFrame(8000, 0, 0.75)).toBe(0);
    });
});
