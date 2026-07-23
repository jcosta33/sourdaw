import { describe, it, expect } from 'vitest';

import { freqToLogX, dbToY, dbToYLiveAnalyser } from '../spectrumMath';

describe('freqToLogX', () => {
    it('should map the axis floor (20 Hz) to x=0', () => {
        expect(freqToLogX(20, 1000)).toBe(0);
    });

    it('should map the axis ceiling (20 kHz) to x=width', () => {
        expect(freqToLogX(20_000, 1000)).toBe(1000);
    });

    it('should place exactly one decade above the floor at 1/3 of the width', () => {
        // 20 Hz -> 20 kHz spans exactly 3 decades, so 200 Hz (one decade up) sits at 1/3.
        expect(freqToLogX(200, 1000)).toBeCloseTo(1000 / 3, 10);
    });

    it('should clamp frequencies below 20 Hz to the axis floor', () => {
        expect(freqToLogX(5, 1000)).toBe(freqToLogX(20, 1000));
    });

    it('should increase monotonically with frequency', () => {
        const low = freqToLogX(100, 1000);
        const mid = freqToLogX(1000, 1000);
        const high = freqToLogX(10_000, 1000);
        expect(low).toBeLessThan(mid);
        expect(mid).toBeLessThan(high);
    });

    it('should respect a custom maxFreq (e.g. Nyquist) as the new ceiling', () => {
        expect(freqToLogX(2000, 1000, 2000)).toBe(1000);
    });

    it('should place the same input frequency differently under different maxFreq axes', () => {
        const wideAxis = freqToLogX(1000, 1000, 20_000);
        const narrowAxis = freqToLogX(1000, 1000, 2000);
        expect(narrowAxis).toBeGreaterThan(wideAxis);
    });
});

describe('dbToY', () => {
    it('should map maxDb to y=0 (top of the display)', () => {
        expect(dbToY(0, 200)).toBe(0);
    });

    it('should map minDb to y=height (bottom of the display)', () => {
        expect(dbToY(-60, 200)).toBe(200);
    });

    it('should map the midpoint dB to the midpoint y', () => {
        expect(dbToY(-30, 200)).toBe(100);
    });

    it('should clamp values above maxDb to y=0', () => {
        expect(dbToY(10, 200)).toBe(0);
    });

    it('should clamp values below minDb to y=height', () => {
        expect(dbToY(-100, 200)).toBe(200);
    });

    it('should honor custom minDb/maxDb bounds', () => {
        // range -40..20 (60 total); -20 is 20 units above the floor => 1/3 up from the bottom.
        expect(dbToY(-20, 90, -40, 20)).toBeCloseTo(60, 10);
    });
});

describe('dbToYLiveAnalyser', () => {
    it('should map the +6 dB headroom ceiling to y=0', () => {
        expect(dbToYLiveAnalyser(6, 200)).toBe(0);
    });

    it('should map -80 dB to y=height', () => {
        expect(dbToYLiveAnalyser(-80, 200)).toBe(200);
    });

    it('should place 0 dB below the top edge to account for the 6 dB headroom', () => {
        // range is -80..6 (86 total); 0 dB sits 80 units above the floor.
        expect(dbToYLiveAnalyser(0, 200)).toBeCloseTo((200 * 6) / 86, 10);
        expect(dbToYLiveAnalyser(0, 200)).toBeGreaterThan(0);
    });
});
