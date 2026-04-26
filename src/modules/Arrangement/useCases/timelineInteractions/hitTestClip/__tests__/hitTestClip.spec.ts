import { describe, it, expect } from 'vitest';

import * as subject from '../hitTestClip';

describe('hitTestClip', () => {
    it('should export hitTestClip', () => {
        expect(subject.hitTestClip).toBeDefined();
        const time = typeof subject.hitTestClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
