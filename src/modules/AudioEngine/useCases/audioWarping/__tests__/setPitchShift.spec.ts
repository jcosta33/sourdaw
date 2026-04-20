import { describe, it, expect } from 'vitest';

import * as subject from '../setPitchShift';

describe('setPitchShift', () => {
    it('should export setPitchShift', () => {
        expect(subject.setPitchShift).toBeDefined();
        const t = typeof subject.setPitchShift;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
