import { describe, it, expect } from 'vitest';

import * as subject from '../setClockDivision';

describe('setClockDivision', () => {
    it('should export setClockDivision', () => {
        expect(subject.setClockDivision).toBeDefined();
        const t = typeof subject.setClockDivision;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
