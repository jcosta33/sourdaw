import { describe, it, expect } from 'vitest';
import { clamp } from '../clamp';

describe('clamp', () => {
    it('should return the value when it lies within the range', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should return min when the value is below the range', () => {
        expect(clamp(-1, 0, 10)).toBe(0);
    });

    it('should return max when the value is above the range', () => {
        expect(clamp(11, 0, 10)).toBe(10);
    });
});
