import { describe, it, expect } from 'vitest';
import * as subject from '../initSamplerEngine';

describe('initSamplerEngine', () => {
    it('should export initSamplerEngine', () => {
        expect(subject.initSamplerEngine).toBeDefined();
        const t = typeof subject.initSamplerEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
