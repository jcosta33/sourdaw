import { describe, it, expect } from 'vitest';

import { computeMomentaryLUFS } from '../computeMomentaryLUFS';

describe('computeMomentaryLUFS', () => {
    it('should return the silence floor for an empty buffer', () => {
        expect(computeMomentaryLUFS(new Float32Array(0))).toBe(-70);
    });

    it('should return the silence floor for a fully silent window', () => {
        expect(computeMomentaryLUFS(new Float32Array(4800))).toBe(-70);
    });

    it('should produce a finite loudness value for non-silent audio', () => {
        const s = new Float32Array(4800);
        for (let i = 0; i < s.length; i++) {
            s[i] = Math.sin(i * 0.1) * 0.5;
        }
        const lufs = computeMomentaryLUFS(s, 48000);
        expect(Number.isFinite(lufs)).toBe(true);
        expect(lufs).toBeGreaterThan(-70);
    });
});
