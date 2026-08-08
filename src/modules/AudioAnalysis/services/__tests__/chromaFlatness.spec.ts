import { describe, it, expect } from 'vitest';

import { chromaFlatness } from '../chromaFlatness';

describe('chromaFlatness', () => {
    it('is 1 for a perfectly uniform chroma at any level', () => {
        expect(chromaFlatness(Array.from({ length: 12 }, () => 1))).toBeCloseTo(1, 12);
        expect(chromaFlatness(Array.from({ length: 12 }, () => 0.003))).toBeCloseTo(1, 12);
    });

    it('collapses toward 0 when the energy sits in one pitch class', () => {
        const spike = Array.from({ length: 12 }, () => 0);
        spike[0] = 1;

        expect(chromaFlatness(spike)).toBeLessThan(1e-6);
    });

    it('falls as energy concentrates into fewer pitch classes', () => {
        const sevenOfTwelve = Array.from({ length: 12 }, () => 0.01);
        for (const pitchClass of [0, 2, 4, 5, 7, 9, 11]) {
            sevenOfTwelve[pitchClass] = 1;
        }
        const threeOfTwelve = Array.from({ length: 12 }, () => 0.01);
        for (const pitchClass of [0, 4, 7]) {
            threeOfTwelve[pitchClass] = 1;
        }

        expect(chromaFlatness(threeOfTwelve)).toBeLessThan(chromaFlatness(sevenOfTwelve));
        expect(chromaFlatness(sevenOfTwelve)).toBeLessThan(1);
    });

    it('is barely reduced by a small perturbation of a uniform chroma', () => {
        // The case the detector has to survive: broadband material whose bins
        // differ slightly. The correlation stage happily fits a key to that
        // shape; flatness reports it as near-uniform.
        const almostUniform = [1, 1.02, 0.98, 1.01, 0.99, 1.03, 0.97, 1, 1.01, 0.99, 1.02, 0.98];

        expect(chromaFlatness(almostUniform)).toBeGreaterThan(0.99);
    });

    it('is 0 for an empty or all-zero chroma', () => {
        expect(chromaFlatness([])).toBe(0);
        expect(chromaFlatness(Array.from({ length: 12 }, () => 0))).toBe(0);
    });
});
