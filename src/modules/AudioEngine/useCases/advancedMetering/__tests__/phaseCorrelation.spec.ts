import { describe, it, expect } from 'vitest';

import { PhaseCorrelationMeter, computePhaseCorrelation } from '../phaseCorrelation';

describe('computePhaseCorrelation', () => {
    it('should return 1 for empty buffers', () => {
        expect(computePhaseCorrelation(new Float32Array(0), new Float32Array(0))).toBe(1);
    });

    it('should return 1 for identical mono signals', () => {
        const alpha = new Float32Array([0.5, -0.5, 0.25]);
        expect(computePhaseCorrelation(alpha, alpha)).toBeCloseTo(1);
    });

    it('should return -1 when left is the inverse of right', () => {
        const left = new Float32Array([1, -1, 0.5]);
        const right = new Float32Array([-1, 1, -0.5]);
        expect(computePhaseCorrelation(left, right)).toBeCloseTo(-1);
    });

    it('should return near 0 for uncorrelated (quadrature) signals', () => {
        // A sine and a cosine over a full period are orthogonal — their
        // inner product integrates to ~0 regardless of amplitude.
        const len = 256;
        const left = new Float32Array(len);
        const right = new Float32Array(len);
        for (let index = 0; index < len; index++) {
            const phase = (2 * Math.PI * index) / len;
            left[index] = Math.sin(phase);
            right[index] = Math.cos(phase);
        }
        expect(computePhaseCorrelation(left, right)).toBeCloseTo(0, 2);
    });

    it('should return a deterministic, non-NaN result for digital silence (non-empty all-zero buffers)', () => {
        const left = new Float32Array(64);
        const right = new Float32Array(64);
        const result = computePhaseCorrelation(left, right);
        expect(result).not.toBeNaN();
        expect(result).toBe(1);
        // Deterministic: a second call on the same silent input reads the same.
        expect(computePhaseCorrelation(left, right)).toBe(result);
    });
});

describe('PhaseCorrelationMeter', () => {
    it('should smooth successive measurements toward the latest sample', () => {
        const meter = new PhaseCorrelationMeter();
        const mono = new Float32Array([1, 1, 1]);
        const first = meter.update(mono, mono);
        expect(first).toBeCloseTo(1);
        const inv = new Float32Array([-1, -1, -1]);
        const second = meter.update(mono, inv);
        expect(second).toBeLessThan(first);
        expect(meter.value).toBe(second);
    });
});
