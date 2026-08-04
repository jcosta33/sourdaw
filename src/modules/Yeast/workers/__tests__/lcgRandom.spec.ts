import { describe, it, expect } from 'vitest';

import { nextLcg, gaussianLcg, LCG_MAX } from '../lcgRandom';

describe('nextLcg', () => {
    it('computes the exact LCG step: (state * 1103515245 + 12345) & 0x7fffffff', () => {
        // nextLcg(1) = (1 * 1103515245 + 12345) & 0x7fffffff = 1103527590
        expect(nextLcg(1)).toBe(1103527590);
    });

    it('nextLcg(0) = (0 + 12345) & 0x7fffffff = 12345', () => {
        expect(nextLcg(0)).toBe(12345);
    });

    it('masks to 31 bits (LCG_MAX = 0x7fffffff)', () => {
        // Any result must be <= LCG_MAX.
        for (let i = 0; i < 100; i++) {
            expect(nextLcg(i)).toBeLessThanOrEqual(LCG_MAX);
            expect(nextLcg(i)).toBeGreaterThanOrEqual(0);
        }
    });

    it('is deterministic: same seed always produces same next state', () => {
        expect(nextLcg(42)).toBe(nextLcg(42));
    });

    it('produces a known sequence', () => {
        // Chain: 0 → 12345 → nextLcg(12345)
        const s0 = nextLcg(0);
        const s1 = nextLcg(s0);
        expect(s0).toBe(12345);
        // s1 = (12345 * 1103515245 + 12345) & 0x7fffffff
        expect(s1).toBe((12345 * 1103515245 + 12345) & 0x7fffffff);
    });
});

describe('gaussianLcg', () => {
    it('advances the LCG exactly two steps', () => {
        const result = gaussianLcg(0, 0, 1);
        // state should be nextLcg(nextLcg(0)) = nextLcg(12345)
        const expectedState = nextLcg(nextLcg(0));
        expect(result.state).toBe(expectedState);
    });

    it('returns mean + sigma * z (zero mean, unit sigma)', () => {
        const result = gaussianLcg(42, 0, 1);
        // Manually compute z from the same LCG sequence.
        const s1 = nextLcg(42);
        const u1 = s1 / LCG_MAX;
        const s2 = nextLcg(s1);
        const u2 = s2 / LCG_MAX;
        const z = Math.sqrt(-2 * Math.log(Math.max(1e-10, u1))) * Math.cos(2 * Math.PI * u2);
        expect(result.value).toBeCloseTo(z, 10);
    });

    it('shifts by mean when sigma is non-zero', () => {
        const result = gaussianLcg(100, 5, 2);
        const resultZero = gaussianLcg(100, 0, 2);
        // result.value = 5 + 2*z, resultZero.value = 0 + 2*z → diff = 5.
        expect(result.value - resultZero.value).toBeCloseTo(5, 10);
    });

    it('scales by sigma', () => {
        const result1 = gaussianLcg(200, 0, 1);
        const result2 = gaussianLcg(200, 0, 3);
        // result2.value / result1.value = 3 (since both use same z, mean=0).
        expect(result2.value).toBeCloseTo(result1.value * 3, 5);
    });

    it('is deterministic: same seed produces same output', () => {
        const a = gaussianLcg(0xdead, 0, 1);
        const b = gaussianLcg(0xdead, 0, 1);
        expect(a).toEqual(b);
    });

    it('produces a finite value for all seeds (no NaN from log(0))', () => {
        for (let i = 0; i < 50; i++) {
            const result = gaussianLcg(i, 0, 1);
            expect(Number.isFinite(result.value)).toBe(true);
        }
    });
});
