import { describe, it, expect } from 'vitest';

import * as subject from '../setYeastProcessorParam';

describe('setYeastProcessorParam', () => {
    it('should export setYeastProcessorParam', () => {
        expect(subject.setYeastProcessorParam).toBeDefined();
        const time = typeof subject.setYeastProcessorParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
