import { describe, it, expect } from 'vitest';
import * as subject from '../processorFactory';

describe('processorFactory', () => {
    it('should export createProcessor', () => {
        expect(subject.createProcessor).toBeDefined();
        const t = typeof subject.createProcessor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
