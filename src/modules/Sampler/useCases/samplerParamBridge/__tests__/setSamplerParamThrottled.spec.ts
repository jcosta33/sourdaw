import { describe, it, expect } from 'vitest';
import * as subject from '../setSamplerParamThrottled';

describe('setSamplerParamThrottled', () => {
    it('should export setSamplerParamThrottled', () => {
        expect(subject.setSamplerParamThrottled).toBeDefined();
        const t = typeof subject.setSamplerParamThrottled;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
