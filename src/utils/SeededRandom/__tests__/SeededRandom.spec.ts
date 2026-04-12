import { describe, it, expect } from 'vitest';

import { createSeededRandom, generateSeed } from '../SeededRandom';

describe('SeededRandom', () => {
    it('should produce deterministic output for the same seed', () => {
        const a = createSeededRandom(12345);
        const b = createSeededRandom(12345);
        expect(a()).toBe(b());
        expect(a()).toBe(b());
    });

    it('should return values in [0, 1)', () => {
        const rng = createSeededRandom(99);
        for (let i = 0; i < 20; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('should produce generateSeed in uint32 range', () => {
        const s = generateSeed();
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xffffffff);
    });
});
