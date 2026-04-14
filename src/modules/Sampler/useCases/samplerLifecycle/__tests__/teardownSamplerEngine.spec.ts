import { describe, it, expect } from 'vitest';
import * as subject from '../teardownSamplerEngine';

describe('teardownSamplerEngine', () => {
    it('should export teardownSamplerEngine', () => {
        expect(subject.teardownSamplerEngine).toBeDefined();
        const t = typeof subject.teardownSamplerEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
