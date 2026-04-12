import { describe, it, expect } from 'vitest';

import { PhaseCorrelationMeter, computePhaseCorrelation } from '../phaseCorrelation';

describe('computePhaseCorrelation', () => {
    it('should return 1 for empty buffers', () => {
        expect(computePhaseCorrelation(new Float32Array(0), new Float32Array(0))).toBe(1);
    });

    it('should return 1 for identical mono signals', () => {
        const a = new Float32Array([0.5, -0.5, 0.25]);
        expect(computePhaseCorrelation(a, a)).toBeCloseTo(1);
    });

    it('should return -1 when left is the inverse of right', () => {
        const left = new Float32Array([1, -1, 0.5]);
        const right = new Float32Array([-1, 1, -0.5]);
        expect(computePhaseCorrelation(left, right)).toBeCloseTo(-1);
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
