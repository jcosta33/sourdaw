import { describe, it, expect } from 'vitest';

import * as subject from '../setPitchShift';

describe('setPitchShift', () => {
    it('should export setPitchShift', () => {
        expect(subject.setPitchShift).toBeDefined();
        const time = typeof subject.setPitchShift;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
