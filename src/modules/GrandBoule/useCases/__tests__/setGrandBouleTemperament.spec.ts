import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleTemperament';

describe('setGrandBouleTemperament', () => {
    it('should export setGrandBouleTemperament', () => {
        expect(subject.setGrandBouleTemperament).toBeDefined();
        const t = typeof subject.setGrandBouleTemperament;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
