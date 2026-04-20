import { describe, it, expect } from 'vitest';

import * as subject from '../getClockValue';

describe('getClockValue', () => {
    it('should export getClockValue', () => {
        expect(subject.getClockValue).toBeDefined();
        const t = typeof subject.getClockValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
