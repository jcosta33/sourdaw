import { describe, it, expect } from 'vitest';

import { clamp } from '../clamp';

describe('clamp', () => {
    it('should clamp values below the minimum', () => {
        expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should clamp values above the maximum', () => {
        expect(clamp(100, 0, 10)).toBe(10);
    });

    it('should leave values inside the range unchanged', () => {
        expect(clamp(3, 0, 10)).toBe(3);
    });
});
