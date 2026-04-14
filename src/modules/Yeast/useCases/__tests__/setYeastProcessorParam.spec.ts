import { describe, it, expect } from 'vitest';
import * as subject from '../setYeastProcessorParam';

describe('setYeastProcessorParam', () => {
    it('should export setYeastProcessorParam', () => {
        expect(subject.setYeastProcessorParam).toBeDefined();
        const t = typeof subject.setYeastProcessorParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
