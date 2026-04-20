import { describe, it, expect } from 'vitest';

import { IntegratedLUFS } from '../IntegratedLUFS';

describe('IntegratedLUFS', () => {
    it('calculates average power over accumulated blocks', () => {
        const lufs = new IntegratedLUFS();

        // Push some values
        lufs.push(-10);
        lufs.push(-10);

        expect(lufs.value).toBeCloseTo(-10, 1);
    });

    it('applies absolute gating at -70 LUFS', () => {
        const lufs = new IntegratedLUFS();

        lufs.push(-10);
        lufs.push(-100); // Gated (ignored)

        expect(lufs.value).toBeCloseTo(-10, 1);
    });

    it('resets correctly', () => {
        const lufs = new IntegratedLUFS();
        lufs.push(-5);
        lufs.reset();
        expect(lufs.value).toBe(-70);
    });

    it('returns -70 if empty', () => {
        const lufs = new IntegratedLUFS();
        expect(lufs.value).toBe(-70);
    });
});
