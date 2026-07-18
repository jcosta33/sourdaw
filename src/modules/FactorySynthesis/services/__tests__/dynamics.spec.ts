import { describe, it, expect } from 'vitest';

import { softClip, normalize } from '../dynamics';

describe('softClip', () => {
    it('reduces peak amplitude', () => {
        const buf = new Float32Array([2, -2, 0.5, -0.5]);
        softClip(buf, 1);
        expect(Math.abs(buf[0]!)).toBeLessThan(2);
        expect(Math.abs(buf[1]!)).toBeLessThan(2);
    });

    it('keeps small values mostly unchanged', () => {
        const buf = new Float32Array([0.1]);
        softClip(buf, 1);
        expect(buf[0]!).toBeCloseTo(0.1, 1);
    });

    it('is bounded to -1..1', () => {
        const buf = new Float32Array(100);
        for (let i = 0; i < buf.length; i++) {
            buf[i] = (i / 50 - 1) * 5;
        }
        softClip(buf, 3);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]!).toBeGreaterThanOrEqual(-1);
            expect(buf[i]!).toBeLessThanOrEqual(1);
        }
    });

    it('drive increases saturation at high input', () => {
        const low = new Float32Array([10]);
        softClip(low, 1);
        const high = new Float32Array([10]);
        softClip(high, 5);
        // Higher drive pushes both closer to tanh asymptote but high drive saturates more
        expect(Math.abs(high[0]!)).toBeCloseTo(1, 0);
        expect(Math.abs(low[0]!)).toBeLessThan(Math.abs(high[0]!) + 0.01);
    });
});

describe('normalize', () => {
    it('scales peak to target', () => {
        const buf = new Float32Array([0.5, -0.5, 0.25]);
        normalize(buf, 0.95);
        expect(Math.abs(buf[0]!)).toBeCloseTo(0.95, 2);
        expect(Math.abs(buf[1]!)).toBeCloseTo(0.95, 2);
        expect(Math.abs(buf[2]!)).toBeCloseTo(0.475, 2);
    });

    it('preserves relative amplitudes', () => {
        const buf = new Float32Array([1, 0.5, 0.25]);
        normalize(buf, 0.9);
        const ratio = buf[1]! / buf[0]!;
        expect(ratio).toBeCloseTo(0.5, 5);
    });

    it('does nothing on silence', () => {
        const buf = new Float32Array([0, 0, 0]);
        normalize(buf, 0.95);
        expect(buf).toEqual(new Float32Array([0, 0, 0]));
    });

    it('preserves sign', () => {
        const buf = new Float32Array([0.5, -0.3]);
        normalize(buf, 1.0);
        expect(buf[0]!).toBeGreaterThan(0);
        expect(buf[1]!).toBeLessThan(0);
    });
});
