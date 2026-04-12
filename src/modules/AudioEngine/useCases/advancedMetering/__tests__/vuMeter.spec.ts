import { describe, it, expect } from 'vitest';

import { VUMeter } from '../vuMeter';

describe('VUMeter', () => {
    it('should keep level at zero for silent input', () => {
        const vu = new VUMeter();
        vu.update(new Float32Array(128), 0.016);
        expect(vu.level).toBe(0);
    });

    it('should rise toward the RMS of a loud signal', () => {
        const vu = new VUMeter();
        const loud = new Float32Array(64).fill(0.8);
        vu.update(loud, 0.1);
        expect(vu.level).toBeGreaterThan(0);
        expect(vu.level).toBeLessThanOrEqual(1);
    });

    it('should reset level and peak state', () => {
        const vu = new VUMeter();
        vu.update(new Float32Array(32).fill(1), 0.2);
        expect(vu.level).toBeGreaterThan(0);
        vu.reset();
        expect(vu.level).toBe(0);
        expect(vu.peak).toBe(0);
    });
});
