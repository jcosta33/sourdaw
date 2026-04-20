import { describe, it, expect } from 'vitest';

import * as subject from '../setYeastProcessorBypass';

describe('setYeastProcessorBypass', () => {
    it('should export setYeastProcessorBypass', () => {
        expect(subject.setYeastProcessorBypass).toBeDefined();
        const t = typeof subject.setYeastProcessorBypass;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
