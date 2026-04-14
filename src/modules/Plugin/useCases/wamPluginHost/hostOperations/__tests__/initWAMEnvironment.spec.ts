import { describe, it, expect } from 'vitest';
import * as subject from '../initWAMEnvironment';

describe('initWAMEnvironment', () => {
    it('should export initWAMEnvironment', () => {
        expect(subject.initWAMEnvironment).toBeDefined();
        const t = typeof subject.initWAMEnvironment;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
