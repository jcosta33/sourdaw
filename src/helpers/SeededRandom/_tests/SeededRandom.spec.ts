import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSeededRandom, generateSeed } from '../SeededRandom';

describe('createSeededRandom', () => {
    it('should return values in [0, 1)', () => {
        const rng = createSeededRandom(42);
        for (let i = 0; i < 50; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('should produce the same sequence for the same seed', () => {
        const a = createSeededRandom(9_001);
        const b = createSeededRandom(9_001);
        expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
    });

    it('should produce different sequences for different seeds', () => {
        const a = createSeededRandom(1);
        const b = createSeededRandom(2);
        expect(a()).not.toBe(b());
    });
});

describe('generateSeed', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should derive a non-negative 32-bit integer from Math.random', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(generateSeed()).toBe(2_147_483_648);
    });
});
