import { describe, it, expect } from 'vitest';

import * as subject from '../setYeastProcessorBypass';

describe('setYeastProcessorBypass', () => {
    it('should export setYeastProcessorBypass', () => {
        expect(subject.setYeastProcessorBypass).toBeDefined();
        const time = typeof subject.setYeastProcessorBypass;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
