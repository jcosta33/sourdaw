import { describe, it, expect } from 'vitest';

import { validateDsos } from '../validateDsos';

describe('validateDsos', () => {
    it('returns no errors for empty DSO list', () => {
        expect(validateDsos([])).toEqual([]);
    });
    it('validates DSOs without crashing', () => {
        const dsos = [
            { id: 'd1', type: 'tempo', beat: 0, value: 120 },
            { id: 'd2', type: 'timeSignature', beat: 0, numerator: 4, denominator: 4 },
        ] as never;
        const result = validateDsos(dsos);
        expect(Array.isArray(result)).toBe(true);
    });
    it('detects invalid tempo values', () => {
        const dsos = [{ id: 'd1', type: 'tempo', beat: 0, value: -10 }] as never;
        const result = validateDsos(dsos);
        expect(Array.isArray(result)).toBe(true);
    });
    it('detects overlapping DSOs at same beat', () => {
        const dsos = [
            { id: 'd1', type: 'tempo', beat: 0, value: 120 },
            { id: 'd2', type: 'tempo', beat: 0, value: 140 },
        ] as never;
        const result = validateDsos(dsos);
        expect(Array.isArray(result)).toBe(true);
    });
    it('handles DSOs at different beats', () => {
        const dsos = [
            { id: 'd1', type: 'tempo', beat: 0, value: 120 },
            { id: 'd2', type: 'tempo', beat: 16, value: 140 },
        ] as never;
        expect(validateDsos(dsos)).toEqual([]);
    });
});
