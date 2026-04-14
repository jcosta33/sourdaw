import { describe, it, expect } from 'vitest';
import * as subject from '../VelocityProcessor';

describe('VelocityProcessor', () => {
    it('should export VelocityProcessor', () => {
        expect(subject.VelocityProcessor).toBeDefined();
        const t = typeof subject.VelocityProcessor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
