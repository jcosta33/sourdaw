import { describe, it, expect } from 'vitest';

import * as subject from '../randomizeLatent';

describe('randomizeLatent', () => {
    it('should export randomizeLatent', () => {
        expect(subject.randomizeLatent).toBeDefined();
        const t = typeof subject.randomizeLatent;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
