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
        const state = new Float32Array(4800);
        for (let index = 0; index < state.length; index++) {
            state[index] = Math.sin(index * 0.1) * 0.5;
        }
        const lufs = computeMomentaryLUFS(state, 48000);
        expect(Number.isFinite(lufs)).toBe(true);
        expect(lufs).toBeGreaterThan(-70);
    });
});
