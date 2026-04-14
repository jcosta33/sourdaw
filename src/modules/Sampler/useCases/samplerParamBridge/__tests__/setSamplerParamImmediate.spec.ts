import { describe, it, expect } from 'vitest';
import * as subject from '../setSamplerParamImmediate';

describe('setSamplerParamImmediate', () => {
    it('should export setSamplerParamImmediate', () => {
        expect(subject.setSamplerParamImmediate).toBeDefined();
        const t = typeof subject.setSamplerParamImmediate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
