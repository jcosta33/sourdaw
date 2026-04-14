import { describe, it, expect } from 'vitest';
import * as subject from '../hitTestClip';

describe('hitTestClip', () => {
    it('should export hitTestClip', () => {
        expect(subject.hitTestClip).toBeDefined();
        const t = typeof subject.hitTestClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
